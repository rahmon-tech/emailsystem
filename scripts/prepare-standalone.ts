import { cp, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function prepareStandalone(root = process.cwd()) {
  const web = resolve(root, "apps/web");
  const standaloneApp = join(web, ".next/standalone/apps/web");
  const server = join(standaloneApp, "server.js");
  const sourceStatic = join(web, ".next/static");
  const targetStatic = join(standaloneApp, ".next/static");
  const sourcePublic = join(web, "public");
  const targetPublic = join(standaloneApp, "public");

  if (!(await exists(server)))
    throw new Error(
      "Standalone server output is missing. Build the web application with Next.js output=standalone first.",
    );
  if (!(await exists(sourceStatic)))
    throw new Error("Next.js static browser assets are missing after the build.");

  await mkdir(join(standaloneApp, ".next"), { recursive: true });
  await rm(targetStatic, { recursive: true, force: true });
  await cp(sourceStatic, targetStatic, { recursive: true });

  await rm(targetPublic, { recursive: true, force: true });
  if (await exists(sourcePublic))
    await cp(sourcePublic, targetPublic, { recursive: true });

  console.log("Prepared standalone runtime with current .next/static assets.");
  if (await exists(sourcePublic)) console.log("Copied web public assets into standalone runtime.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareStandalone().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
