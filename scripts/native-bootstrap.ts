import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";
import Redis from "ioredis";
import { Client } from "pg";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url(),
  NEXT_PUBLIC_BASE_PATH: z
    .string()
    .regex(/^(?:\/[a-zA-Z0-9_-]+)*$/)
    .default(""),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().regex(/^[a-f0-9]{64}$/i),
  CREDENTIAL_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
});

type NativeBootstrapEnv = z.infer<typeof environmentSchema>;

function versionParts(value: string) {
  const parts = value.split(".").slice(0, 3).map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part) || part < 0))
    throw new Error(`Invalid semantic version: ${value}`);
  while (parts.length < 3) parts.push(0);
  return parts as [number, number, number];
}

export function versionAtLeast(current: string, minimum: string) {
  const left = versionParts(current);
  const right = versionParts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export function validateNativeBootstrapEnv(
  raw: Record<string, string | undefined>,
): NativeBootstrapEnv {
  const parsed = environmentSchema.parse(raw);
  const appUrl = new URL(parsed.APP_URL);
  const normalizedPath = appUrl.pathname.replace(/\/$/, "");
  if (
    appUrl.username ||
    appUrl.password ||
    appUrl.search ||
    appUrl.hash ||
    normalizedPath !== parsed.NEXT_PUBLIC_BASE_PATH
  )
    throw new Error(
      "APP_URL path must match NEXT_PUBLIC_BASE_PATH, without credentials, query or fragment.",
    );
  if (parsed.NODE_ENV === "production" && appUrl.protocol !== "https:")
    throw new Error("Production APP_URL must use HTTPS.");
  return parsed;
}

export function nativeEndpointWarnings(
  raw: Record<string, string | undefined>,
) {
  const parsed = validateNativeBootstrapEnv(raw);
  const warnings: string[] = [];
  if (new URL(parsed.DATABASE_URL).hostname === "postgres")
    warnings.push(
      "DATABASE_URL uses host 'postgres', which is normally a Docker Compose service name rather than a native host address.",
    );
  if (new URL(parsed.REDIS_URL).hostname === "redis")
    warnings.push(
      "REDIS_URL uses host 'redis', which is normally a Docker Compose service name rather than a native host address.",
    );
  return warnings;
}

async function loadEnvironment() {
  let source: string;
  try {
    source = await readFile(".env", "utf8");
  } catch {
    throw new Error(
      "Missing .env. Copy .env.example to .env, configure native PostgreSQL/Redis URLs, and generate both 64-hex secrets before running bootstrap.",
    );
  }
  const fileValues = parse(source);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string",
    ),
  );
  return { ...fileValues, ...inherited };
}

async function checkEnvPermissions(nodeEnv: string) {
  if (process.platform === "win32") return;
  const mode = (await stat(".env")).mode & 0o777;
  if (nodeEnv === "production" && (mode & 0o077) !== 0)
    throw new Error(
      `.env permissions are ${mode.toString(8)}; production native installs must restrict the file to the owner (for example chmod 600 .env).`,
    );
}

async function checkPostgres(connectionString: string) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkRedis(url: string) {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
  });
  try {
    await client.connect();
    if ((await client.ping()) !== "PONG") throw new Error("Redis PING did not return PONG.");
  } finally {
    client.disconnect();
  }
}

async function packageRequirements() {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    name?: string;
    packageManager?: string;
    engines?: { node?: string };
  };
  if (packageJson.name !== "emailsystem")
    throw new Error("Run native bootstrap from the EmailSystem repository root.");
  const manager = packageJson.packageManager?.match(/^pnpm@(.+)$/)?.[1];
  if (!manager) throw new Error("package.json must pin a pnpm version.");
  const nodeFloor = packageJson.engines?.node?.match(/^>=(.+)$/)?.[1];
  if (!nodeFloor) throw new Error("package.json must declare a minimum Node version.");
  return { pnpm: manager, node: nodeFloor };
}

function installedPnpmVersion() {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error("pnpm is unavailable. Enable Corepack and activate the repository-pinned pnpm version.");
  return result.stdout.trim();
}

function generatePrisma() {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, ["db:generate"], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Prisma client generation failed.");
}

export async function runNativeBootstrap({
  checkOnly = false,
}: {
  checkOnly?: boolean;
} = {}) {
  const requirements = await packageRequirements();
  if (!versionAtLeast(process.versions.node, requirements.node))
    throw new Error(
      `Node ${requirements.node}+ is required; found ${process.versions.node}.`,
    );
  const pnpmVersion = installedPnpmVersion();
  if (pnpmVersion !== requirements.pnpm)
    throw new Error(
      `pnpm ${requirements.pnpm} is required; found ${pnpmVersion}. Run corepack prepare pnpm@${requirements.pnpm} --activate.`,
    );

  const raw = await loadEnvironment();
  const environment = validateNativeBootstrapEnv(raw);
  await checkEnvPermissions(environment.NODE_ENV);
  for (const warning of nativeEndpointWarnings(raw)) console.warn(`Warning: ${warning}`);

  await Promise.all([
    checkPostgres(environment.DATABASE_URL),
    checkRedis(environment.REDIS_URL),
  ]);

  if (!checkOnly) generatePrisma();

  console.log("Native bootstrap checks passed: environment, PostgreSQL and Redis are ready.");
  if (!checkOnly) console.log("Prisma client generated successfully.");
  console.log("No SQL migration was run.");
  console.log(
    "For a brand-new database only, apply the repository migrations explicitly with pnpm db:migrate before creating the first user.",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runNativeBootstrap({ checkOnly: process.argv.includes("--check-only") }).catch(
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
