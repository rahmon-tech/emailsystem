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
  const objectIds = [
    ...new Set(
      execFileSync("git", ["rev-list", "--objects", "--all"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      })
        .split("\n")
        .map((line) => line.trim().split(" ", 1)[0])
        .filter(Boolean),
    ),
  ];

  const batchInput = objectIds.join("\n") + "\n";
  const metadata = execFileSync(
    "git",
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    {
      input: batchInput,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  const eligibleBlobIds = metadata
    .split("\n")
    .map((line) => line.trim().split(" "))
    .filter(
      ([sha, type, size]) =>
        Boolean(sha) &&
        type === "blob" &&
        Number.isFinite(Number(size)) &&
        Number(size) <= 2 * 1024 * 1024,
    )
    .map(([sha]) => sha);

  if (eligibleBlobIds.length > 0) {
    const historicalContent = execFileSync("git", ["cat-file", "--batch"], {
      input: eligibleBlobIds.join("\n") + "\n",
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });

    historyBlobsScanned = eligibleBlobIds.length;
    if (containsCredential(historicalContent)) unsafe = true;
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
