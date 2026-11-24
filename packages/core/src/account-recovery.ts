import { timingSafeEqual } from "node:crypto";
import { db } from "@emailsystem/db";
import { AppError, logEvent } from "./errors";
import { consumeLimit, redis } from "./redis";
import { digest, hashPassword } from "./security";

const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_WINDOW_SECONDS = 3600;

export type RecoverySettings = {
  email: string;
  codeHash: string;
  expiresAt: number;
};

export function recoverySettings(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): RecoverySettings | null {
  const email = env.ACCOUNT_RECOVERY_EMAIL?.trim().toLowerCase() ?? "";
  const codeHash = env.ACCOUNT_RECOVERY_CODE_SHA256?.trim() ?? "";
  const expiresRaw = env.ACCOUNT_RECOVERY_EXPIRES_AT?.trim() ?? "";
  const expiresAt = Number(expiresRaw);

  if (
    !email ||
    !SHA256_PATTERN.test(codeHash) ||
    !/^\d{10,13}$/.test(expiresRaw) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > MAX_WINDOW_SECONDS * 1000
  )
    return null;

  return { email, codeHash: codeHash.toLowerCase(), expiresAt };
}

export function isRecoveryCodeValid(code: string, settings: RecoverySettings) {
  if (!CODE_PATTERN.test(code)) return false;
  const suppliedHash = Buffer.from(digest(code), "hex");
  const storedHash = Buffer.from(settings.codeHash, "hex");
  return timingSafeEqual(suppliedHash, storedHash);
}

export async function recoverWithAdminCode(
  emailInput: string,
  code: string,
  newPassword: string,
  ip: string,
) {
  const normalized = emailInput.trim().toLowerCase();
  const deny = () =>
    new AppError(
      400,
      "RECOVERY_UNAVAILABLE",
      "The recovery code is invalid or expired. Contact your administrator.",
    );

  // Don't disclose whether an address exists, or whether recovery is configured.
  if (
    !(await consumeLimit(`account-recover:ip:${digest(ip)}`, 8, 900)) ||
    !(await consumeLimit(`account-recover:email:${digest(normalized)}`, 8, 900))
  )
    throw new AppError(
      429,
      "THROTTLED",
      "Too many recovery attempts. Please try again later.",
    );

  const settings = recoverySettings();
  if (
    !settings ||
    settings.email !== normalized ||
    !isRecoveryCodeValid(code, settings)
  )
    throw deny();

  // Redis SET NX ensures a recovery code can be redeemed only once,
  // even across concurrent web replicas. A database failure consumes
  // the code as well; the administrator must issue a new one.
  const onceKey = `account-recover:used:${settings.codeHash}`;
  const acquired = await redis.set(onceKey, "1", "EX", 3600, "NX");
  if (acquired !== "OK") throw deny();

  const user = await db.user.findUnique({
    where: { email: normalized },
    select: { id: true },
  });
  if (!user) throw deny();

  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });
    await transaction.session.deleteMany({
      where: { userId: user.id },
    });
  });

  logEvent("info", "auth.account_recovered", { via: "railway_admin_code" });
}
