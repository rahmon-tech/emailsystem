import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const domain = process.argv[2];
if (
  !domain ||
  !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)
)
  throw new Error(
    "Usage: node --import tsx scripts/setup-env.ts mail.your-domain.com",
  );
const key = () => randomBytes(32).toString("hex"),
  password = key();
await writeFile(
  ".env",
  `NODE_ENV=production\nAPP_URL=https://${domain}\nDOMAIN=${domain}\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://emailsystem:${password}@postgres:5432/emailsystem\nREDIS_URL=redis://redis:6379\nSESSION_SECRET=${key()}\nCREDENTIAL_ENCRYPTION_KEY=${key()}\nALLOW_MOCK_PROVIDER=false\nWORKER_CONCURRENCY=4\nACTIVITY_RETENTION_DAYS=90\nATTEMPT_RETENTION_DAYS=365\nWEBHOOK_RETENTION_DAYS=30\n`,
  { flag: "wx", mode: 0o600 },
);
console.log("Created .env. Keep an encrypted backup of its keys.");
