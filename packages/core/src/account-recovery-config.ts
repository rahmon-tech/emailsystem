import { timingSafeEqual } from "node:crypto";
import { digest } from "./security";

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
    !/^\d{13}$/.test(expiresRaw) ||
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
