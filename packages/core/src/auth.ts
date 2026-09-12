import { createHmac } from "node:crypto";
import { db } from "@emailsystem/db";
import { config } from "./config";
import { checkPassword, hashPassword, opaqueToken, digest } from "./security";
import { consumeLimit } from "./redis";
import { AppError } from "./errors";
export const sessionCookie = "emailsystem_session";
export const sessionMaxAgeSeconds = 30 * 86400;
const sessionHash = (token: string) =>
  createHmac("sha256", config().SESSION_SECRET).update(token).digest("hex");
let dummyHash: Promise<string> | undefined;
export async function login(email: string, password: string, ip: string) {
  const normalized = email.trim().toLowerCase();
  if (
    !(await consumeLimit(`login:ip:${digest(ip)}`, 30, 900)) ||
    !(await consumeLimit(`login:email:${digest(normalized)}`, 10, 900))
  )
    throw new AppError(
      429,
      "THROTTLED",
      "Too many sign-in attempts. Try again in 15 minutes.",
    );
  const user = await db.user.findUnique({ where: { email: normalized } });
  dummyHash ??= hashPassword(opaqueToken());
  const valid = await checkPassword(
    password,
    user?.passwordHash ?? (await dummyHash),
  );
  if (!valid || !user)
    throw new AppError(401, "INVALID_LOGIN", "Email or password is incorrect.");
  const token = opaqueToken();
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds * 1000);
  await db.session.create({
    data: { tokenHash: sessionHash(token), userId: user.id, expiresAt },
  });
  return { token, expiresAt };
}
export function cookieToken(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(sessionCookie + "="))
      ?.slice(sessionCookie.length + 1) ?? ""
  );
}
export async function userFromToken(token: string) {
  if (!/^[\w-]{43}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sessionHash(token) },
    include: { user: { select: { id: true, email: true } } },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
}
export async function requireUser(request: Request) {
  const user = await userFromToken(cookieToken(request));
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Please sign in.");
  return user;
}
export async function logout(token: string) {
  if (token)
    await db.session.deleteMany({ where: { tokenHash: sessionHash(token) } });
}
export function assertSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(config().APP_URL).origin)
    throw new AppError(403, "ORIGIN", "Request origin is not allowed.");
}
export async function createUser(email: string, password: string) {
  return db.user.create({
    data: {
      email: email.trim().toLowerCase(),
      passwordHash: await hashPassword(password),
    },
    select: { id: true, email: true },
  });
}
