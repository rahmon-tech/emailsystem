import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";
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

export type DockerInstallOptions = {
  resume?: boolean;
  skipAdmin?: boolean;
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

async function environmentExists() {
  try {
    await access(".env");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function prepareEnvironment(
  plan: DockerInstallPlan,
  resume: boolean,
) {
  const exists = await environmentExists();
  if (!exists) {
    if (resume)
      throw new Error(
        "--resume requires the protected .env created by the original installation attempt.",
      );
    await createDockerEnvironment(plan.domain, plan.basePath);
    console.log(
      `\nCreated a protected .env for ${plan.appUrl}. Back this file up securely after installation.`,
    );
    return;
  }

  if (!resume)
    throw new Error(
      "A .env file already exists. For a failed first installation, rerun with --resume. For an existing production installation, follow the documented upgrade procedure instead.",
    );

  const current = parse(await readFile(".env", "utf8"));
  if (
    current.DOMAIN !== plan.domain ||
    (current.NEXT_PUBLIC_BASE_PATH ?? "") !== plan.basePath ||
    current.APP_URL !== plan.appUrl
  )
    throw new Error(
      "The supplied domain/base path does not match the existing .env. Resume only the same installation attempt.",
    );
  console.log(
    `\nResuming the existing installation for ${plan.appUrl}; protected keys and database credentials are unchanged.`,
  );
}

export async function installDocker(
  domainInput: string,
  basePathInput = "",
  options: DockerInstallOptions = {},
) {
  const plan = dockerInstallPlan(domainInput, basePathInput);
  await prepareEnvironment(plan, Boolean(options.resume));

  runDocker(["compose", "version"], "Check Docker Compose");
  runDocker(["compose", "config", "--quiet"], "Validate production configuration");
  runDocker(["compose", "build"], "Build EmailBlast containers");
  runDocker(
    ["compose", "up", "-d", "--wait", "postgres", "redis"],
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

  if (!options.skipAdmin) {
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
  } else {
    console.log(
      "\nSkipping administrator creation. Use this only when the original install attempt already created the intended administrator.",
    );
  }

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
  const args = process.argv.slice(2);
  const resume = args.includes("--resume");
  const skipAdmin = args.includes("--skip-admin");
  const unknown = args.filter(
    (value) => value.startsWith("--") &&
      value !== "--resume" &&
      value !== "--skip-admin",
  );
  if (unknown.length)
    throw new Error("Unknown installer option: " + unknown.join(", "));
  const positional = args.filter((value) => !value.startsWith("--"));
  const domain = positional[0];
  if (!domain || positional.length > 2)
    throw new Error(
      "Usage: pnpm install:docker -- mail.your-domain.com [/emailblast] [--resume] [--skip-admin]",
    );
  if (skipAdmin && !resume)
    throw new Error("--skip-admin is allowed only with --resume.");
  await installDocker(domain, positional[1] ?? "", { resume, skipAdmin });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("\nInstallation stopped safely.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
