import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);

const credentialPatterns = [
  /-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----/,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}\b/,
  /\bre_[A-Za-z0-9_-]{24,}\b/,
  /\bx(?:key|smtp)sib-[A-Za-z0-9_-]{30,}\b/i,
  /\bapi-[A-F0-9]{24,}\b/i,
  /^(?:[A-Z0-9_]*(?:API_KEY|SECRET_KEY|SERVER_TOKEN|ACCOUNT_TOKEN|PASSWORD))[ \t]*=[ \t]*(?![ \t]*(?:$|#|\$\{))[^\r\n]+/m,
];

let unsafe = false;
for (const file of files) {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (credentialPatterns.some((pattern) => pattern.test(source))) unsafe = true;
}

if (unsafe) {
  process.stderr.write(
    "Secret scan failed: a tracked file may contain a credential. No matching value was printed.\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Secret scan passed (${files.length} repository files).\n`,
  );
}
