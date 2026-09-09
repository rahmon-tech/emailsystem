import "dotenv/config";
import dotenv from "dotenv";
import { z } from "zod";
import { existsSync, statSync } from "node:fs";

const localSecretPath = ".env.providers.local";
if (existsSync(localSecretPath) && statSync(localSecretPath).mode & 0o077)
  throw new Error("Set .env.providers.local permissions to 0600 before use.");
dotenv.config({ path: localSecretPath, override: true, quiet: true });

const args = process.argv.slice(2);
const modes = ["--dry-run", "--apply", "--verify"].filter((mode) =>
  args.includes(mode),
);
if (modes.length !== 1)
  throw new Error("Choose exactly one of --dry-run, --apply, or --verify.");
const userArgument = args.indexOf("--user");
const userEmail = z
  .email()
  .parse(
    userArgument >= 0
      ? args[userArgument + 1]
      : process.env.PROVIDER_BOOTSTRAP_USER_EMAIL,
  )
  .toLowerCase();

async function main() {
  const { db } = await import("@emailsystem/db");
  try {
    const {
      applyBootstrapPlan,
      buildBootstrapPlan,
      selectPostmarkTokenSafely,
      summarizeBootstrapPlan,
      verifyBootstrapProviders,
    } = await import("@emailsystem/core/provider-bootstrap");
    const selection = await selectPostmarkTokenSafely(process.env);
    const plan = buildBootstrapPlan(selection.environment);
    const safePlan = summarizeBootstrapPlan(plan);
    if (modes[0] === "--dry-run") {
      process.stdout.write(
        JSON.stringify(
          {
            mode: "dry-run",
            userEmail,
            ...safePlan,
            postmarkProbe: selection.candidates,
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      const user = await db.user.findUnique({ where: { email: userEmail } });
      if (!user) throw new Error("Bootstrap user does not exist.");
      if (modes[0] === "--apply") {
        const applied = await applyBootstrapPlan(user.id, plan);
        process.stdout.write(
          JSON.stringify({ mode: "apply", ...applied }, null, 2) + "\n",
        );
      } else {
        const verified = await verifyBootstrapProviders(user.id, plan);
        process.stdout.write(
          JSON.stringify(
            { mode: "verify", providers: verified, deliveryPerformed: false },
            null,
            2,
          ) + "\n",
        );
      }
    }
  } finally {
    await db.$disconnect();
  }
}

function safeError(error: unknown) {
  let message = error instanceof Error ? error.message : "Unexpected failure.";
  for (const [key, value] of Object.entries(process.env))
    if (
      value &&
      /(?:API_KEY|SECRET|PASSWORD|TOKEN|SMTP_(?:LOGIN|USERNAME))/.test(key)
    )
      message = message.replaceAll(value, "[redacted]");
  return message.replace(/[\r\n]+/g, " ").slice(0, 1000);
}

void main().catch((error) => {
  process.stderr.write(`Provider bootstrap failed: ${safeError(error)}\n`);
  process.exitCode = 1;
});
