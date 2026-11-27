import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  createDockerEnvironment,
  validateBasePath,
  validateInstallDomain,
} from "./setup-env";

export type DockerInstallPlan = {
  domain: string;
  basePath: string;
  appUrl: string;
};

export function dockerInstallPlan(
  domainInput: string,
  basePathInput = "",
): DockerInstallPlan {
  const domain = validateInstallDomain(domainInput);
  const basePath = validateBasePath(basePathInput);
  return {
    domain,
    basePath,
    appUrl: `https://${domain}${basePath}`,
  };
}

function runDocker(args: string[], label: string) {
  console.log(`\n==> ${label}`);
  const result = spawnSync("docker", args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error)
    throw new Error(
      `${label} could not start: ${result.error.message}`,
    );
  if (result.status !== 0)
    throw new Error(
      `${label} failed with exit code ${result.status ?? "unknown"}.`,
    );
}

async function assertFreshInstall() {
  try {
    await access(".env");
    throw new Error(
      "A .env file already exists. The fresh installer will not overwrite or reuse an existing installation. Follow the documented upgrade procedure instead.",
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("A .env file already exists")
    )
      throw error;
  }
}

export async function installDocker(
  domainInput: string,
  basePathInput = "",
) {
  const plan = dockerInstallPlan(domainInput, basePathInput);
  await assertFreshInstall();

  runDocker(["compose", "version"], "Check Docker Compose");
  await createDockerEnvironment(plan.domain, plan.basePath);

  console.log(
    `\nCreated a protected .env for ${plan.appUrl}. Back this file up securely after installation.`,
  );

  runDocker(["compose", "config", "--quiet"], "Validate production configuration");
  runDocker(["compose", "build"], "Build EmailBlast containers");
  runDocker(
    ["compose", "up", "-d", "postgres", "redis"],
    "Start PostgreSQL and Redis",
  );
  runDocker(
    [
      "compose",
      "run",
      "--rm",
      "web",
      "node",
      "node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
    ],
    "Apply versioned database migrations",
  );

  console.log(
    "\nCreate the first administrator. The password is read interactively and is not written to shell history.",
  );
  runDocker(
    [
      "compose",
      "run",
      "--rm",
      "web",
      "node",
      "--import",
      "tsx",
      "scripts/create-user.ts",
    ],
    "Create first administrator",
  );

  runDocker(
    ["compose", "up", "-d", "--wait", "web", "worker", "proxy"],
    "Start EmailBlast",
  );
  runDocker(
    [
      "compose",
      "exec",
      "-T",
      "web",
      "node",
      "-e",
      "const p=process.env.NEXT_PUBLIC_BASE_PATH||''; fetch('http://127.0.0.1:3000'+p+'/health/ready').then(async r=>{if(!r.ok){console.error(await r.text());process.exit(1)}}).catch(e=>{console.error(e);process.exit(1)})",
    ],
    "Verify web/database/Redis readiness",
  );
  runDocker(
    [
      "compose",
      "exec",
      "-T",
      "worker",
      "node",
      "--import",
      "tsx",
      "scripts/worker-health.ts",
    ],
    "Verify worker readiness",
  );

  console.log("\nEmailBlast installation passed local readiness checks.");
  console.log(`Open: ${plan.appUrl}`);
  console.log(
    "If HTTPS is not ready yet, confirm this hostname points to the server and that ports 80/443 are reachable.",
  );
  console.log(
    "Keep an encrypted off-host backup of .env and PostgreSQL before adding production sending credentials.",
  );
}

async function main() {
  const domain = process.argv[2];
  if (!domain)
    throw new Error(
      "Usage: pnpm install:docker -- mail.your-domain.com [/emailblast]",
    );
  await installDocker(domain, process.argv[3] ?? "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("\nInstallation stopped safely.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
