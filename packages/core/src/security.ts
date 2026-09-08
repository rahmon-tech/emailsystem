import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
export interface SealedSecret {
  version: 1;
  iv: string;
  tag: string;
  data: string;
}
function parseKey(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error("Encryption key must be 32 bytes encoded as hex");
  return Buffer.from(key, "hex");
}
export function encryptSecret(
  value: unknown,
  key: string,
  context: string,
): SealedSecret {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", parseKey(key), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}
export function decryptSecret(
  value: SealedSecret,
  key: string,
  context: string,
): Record<string, string> {
  if (value.version !== 1)
    throw new Error("Unsupported credential key version");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    parseKey(key),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(value.data, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as Record<string, string>;
}
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, b) => (e ? reject(e) : resolve(b)),
    ),
  );
export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 256)
    throw new Error("Use a password between 12 and 256 characters");
  const salt = randomBytes(24).toString("hex");
  return `scrypt$32768$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function checkPassword(password: string, hash: string) {
  if (password.length > 256) return false;
  const parts = hash.split("$");
  if (
    parts.length !== 4 ||
    parts[0] !== "scrypt" ||
    parts[1] !== "32768" ||
    !/^[a-f0-9]{48}$/.test(parts[2]) ||
    !/^[a-f0-9]{128}$/.test(parts[3])
  )
    return false;
  return timingSafeEqual(
    await derive(password, parts[2]),
    Buffer.from(parts[3], "hex"),
  );
}
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const opaqueToken = () => randomBytes(32).toString("base64url");
export function makeSignedToken(key: string) {
  const nonce = opaqueToken();
  return `${nonce}.${createHmac("sha256", parseKey(key)).update(nonce).digest("base64url")}`;
}
export function verifySignedToken(token: string, key: string) {
  if (!/^[\w-]{43}\.[\w-]{43}$/.test(token)) return false;
  const [nonce, sig] = token.split(".");
  return timingSafeEqual(
    Buffer.from(sig, "base64url"),
    createHmac("sha256", parseKey(key)).update(nonce).digest(),
  );
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}•••@${domain ?? "hidden"}`;
}
