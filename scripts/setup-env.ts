import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateInstallDomain(value: string) {
  const domain = value.trim().toLowerCase();
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)
  )
    throw new Error(
      "Use a hostname such as mail.your-domain.com.",
    );
  return domain;
}

export function validateBasePath(value = "") {
  const basePath = value.trim();
  if (!/^(?:\/[a-zA-Z0-9_-]+)*$/.test(basePath))
    throw new Error(
      "Use a path such as /emailblast, without a trailing slash.",
    );
  return basePath;
}

export async function createDockerEnvironment(
  domainInput: string,
  basePathInput = "",
  destination = ".env",
) {
  const domain = validateInstallDomain(domainInput);
  const basePath = validateBasePath(basePathInput);
  const key = () => randomBytes(32).toString("hex");
  const password = key();
  const appUrl = `https://${domain}${basePath}`;

  await writeFile(
    destination,
    `NODE_ENV=production
APP_URL=${appUrl}
NEXT_PUBLIC_BASE_PATH=${basePath}
DOMAIN=${domain}
POSTGRES_PASSWORD=${password}
DATABASE_URL=postgresql://emailsystem:${password}@postgres:5432/emailsystem
REDIS_URL=redis://redis:6379
SESSION_SECRET=${key()}
CREDENTIAL_ENCRYPTION_KEY=${key()}
ALLOW_MOCK_PROVIDER=false
WORKER_CONCURRENCY=4
MAX_IMPORT_ROWS=100000
MAX_UPLOAD_BYTES=10000000
ACTIVITY_RETENTION_DAYS=90
ATTEMPT_RETENTION_DAYS=365
WEBHOOK_RETENTION_DAYS=30
EXPERIMENT_EVIDENCE_RETENTION_DAYS=365
EXPERIMENT_MESSAGE_RETENTION_DAYS=30
CLICK_ANALYTICS_RETENTION_DAYS=90
TRACKING_LINK_LIFETIME_DAYS=180
EMAILBLAST_PORT=3087
`,
    { flag: "wx", mode: 0o600 },
  );

  return { domain, basePath, appUrl, destination };
}

async function main() {
  const domain = process.argv[2];
  if (!domain)
    throw new Error(
      "Usage: pnpm node --import tsx scripts/setup-env.ts mail.your-domain.com [/emailblast]",
    );
  const result = await createDockerEnvironment(domain, process.argv[3] ?? "");
  console.log(
    `Created ${result.destination} for ${result.appUrl}. Keep an encrypted backup of its keys.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
