// This public value is embedded at build time by Next.js; it is never a secret.
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const appPath = (path: string) => basePath + path;
