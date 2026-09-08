import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { z } from "zod";
import { db } from "@emailsystem/db";
import { createUser } from "@emailsystem/core/auth";
// Password goes through stdin, never a command-line argument or shell history.
const rl = createInterface({ input: stdin, output: stdout, terminal: false });
try {
  const email = z.email().parse(await rl.question("Email: "));
  const password = await rl.question(
    "Password (12+ characters; input is visible): ",
  );
  const user = await createUser(email, password);
  console.log(`Created ${user.email}`);
} finally {
  rl.close();
  await db.$disconnect();
}
