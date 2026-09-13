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

export function sessionCookiePath() {
  return config().NEXT_PUBLIC_BASE_PATH || "/";
}

export function sessionCookieValue(
  token: string,
  maxAge = sessionMaxAgeSeconds,
  path = sessionCookiePath(),
) {
  const expires = new Date(Date.now() + Math.max(0, maxAge) * 1000).toUTCString();
  return `${sessionCookie}=${token}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${maxAge}; Expires=${expires}; Priority=High${config().NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function clearSessionCookieValue(path = sessionCookiePath()) {
  return `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Priority=High${config().NODE_ENV === "production" ? "; Secure" : ""}`;
}

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

export function cookieTokensFromHeader(header: string | null) {
  if (!header) return [];
  const prefix = sessionCookie + "=";
  return [
    ...new Set(
      header
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.startsWith(prefix))
        .map((s) => s.slice(prefix.length))
        .filter((token) => /^[\w-]{43}$/.test(token)),
    ),
  ];
}

export function cookieTokens(request: Request) {
  return cookieTokensFromHeader(request.headers.get("cookie"));
}

export function cookieToken(request: Request) {
  return cookieTokens(request)[0] ?? "";
}

export async function userFromToken(token: string) {
  if (!/^[\w-]{43}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sessionHash(token) },
    include: { user: { select: { id: true, email: true } } },
  });
  return session && session.expiresAt > new Date() ? session.user : null;
}

export async function userFromTokens(tokens: string[]) {
  for (const token of [...new Set(tokens)]) {
    const user = await userFromToken(token);
    if (user) return { user, token };
  }
  return null;
}

export async function refreshSession(token: string) {
  if (!/^[\w-]{43}$/.test(token)) return null;
  const tokenHash = sessionHash(token);
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds * 1000);
  await db.session.update({ where: { tokenHash }, data: { expiresAt } });
  return { user: session.user, expiresAt };
}

export async function refreshFirstSession(tokens: string[]) {
  for (const token of [...new Set(tokens)]) {
    const refreshed = await refreshSession(token);
    if (refreshed) return { ...refreshed, token };
  }
  return null;
}

export async function requireUser(request: Request) {
  const resolved = await userFromTokens(cookieTokens(request));
  if (!resolved)
    throw new AppError(401, "UNAUTHENTICATED", "Please sign in.");
  return resolved.user;
}
export async function logout(token: string) {
  if (token)
    await db.session.deleteMany({ where: { tokenHash: sessionHash(token) } });
}
export async function logoutTokens(tokens: string[]) {
  for (const token of [...new Set(tokens)]) await logout(token);
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
