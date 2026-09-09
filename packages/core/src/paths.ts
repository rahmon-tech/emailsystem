// This public value is embedded at build time by Next.js; it is never a secret.
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const appPath = (path: string) => basePath + path;

export function absoluteUrlFromRoot(root: string, path: string) {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Application paths must begin with one slash");
  return root.replace(/\/$/, "") + path;
}
