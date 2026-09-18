import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const scanHistory = process.argv.includes("--history");

const credentialPatterns = [
  /-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}\b/,
  /\bre_[A-Za-z0-9_-]{24,}\b/,
  /\bx(?:key|smtp)sib-[A-Za-z0-9_-]{30,}\b/i,
  /\bapi-[A-F0-9]{24,}\b/i,
  /^(?:[A-Z0-9_]*(?:API_KEY|SECRET_KEY|SERVER_TOKEN|ACCOUNT_TOKEN|PASSWORD))[ \t]*=[ \t]*(?![ \t]*(?:$|#|\$\{))[^\r\n]+/m,
];

function containsCredential(source: string) {
  return credentialPatterns.some((pattern) => pattern.test(source));
}

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

let unsafe = false;

for (const file of files) {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (containsCredential(source)) unsafe = true;
}

let historyBlobsScanned = 0;

if (scanHistory) {
  const objects = execFileSync("git", ["rev-list", "--objects", "--all"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const seen = new Set<string>();

  for (const line of objects) {
    const sha = line.split(" ", 1)[0];
    if (!sha || seen.has(sha)) continue;
    seen.add(sha);

    let type: string;
    try {
      type = execFileSync("git", ["cat-file", "-t", sha], {
        encoding: "utf8",
      }).trim();
    } catch {
      continue;
    }
    if (type !== "blob") continue;

    let size = 0;
    try {
      size = Number(
        execFileSync("git", ["cat-file", "-s", sha], {
          encoding: "utf8",
        }).trim(),
      );
    } catch {
      continue;
    }

    // Credential-bearing source/config files should be small. Avoid loading large
    // binary/history blobs into memory.
    if (!Number.isFinite(size) || size > 2 * 1024 * 1024) continue;

    let source: string;
    try {
      source = execFileSync("git", ["cat-file", "-p", sha], {
        encoding: "utf8",
        maxBuffer: 3 * 1024 * 1024,
      });
    } catch {
      continue;
    }

    historyBlobsScanned += 1;
    if (containsCredential(source)) unsafe = true;
  }
}

if (unsafe) {
  process.stderr.write(
    scanHistory
      ? "Secret scan failed: repository files or Git history may contain a credential. No matching value was printed.\n"
      : "Secret scan failed: a repository file may contain a credential. No matching value was printed.\n",
  );
  process.exitCode = 1;
} else {
  const historySuffix = scanHistory
    ? ` and ${historyBlobsScanned} historical blobs`
    : "";
  process.stdout.write(
    `Secret scan passed (${files.length} repository files${historySuffix}).\n`,
  );
}
