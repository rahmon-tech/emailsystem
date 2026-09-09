import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { stdin, stdout } from "node:process";
import { z } from "zod";
import { db } from "@emailsystem/db";
import { createUser } from "@emailsystem/core/auth";
// Credentials enter through stdin only: no arguments, history, files or logs.
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) stdout.write(chunk);
    callback();
  },
});
try {
  let email: string, password: string;
  if (stdin.isTTY) {
    const rl = createInterface({ input: stdin, output, terminal: true });
    try {
      email = await rl.question("Email: ");
      stdout.write("Password (12+ characters; hidden): ");
      muted = true;
      password = await rl.question("");
      muted = false;
      stdout.write("\n");
    } finally {
      muted = false;
      rl.close();
    }
  } else {
    let input = "";
    for await (const chunk of stdin) {
      input += chunk.toString();
      if (input.length > 4096)
        throw new Error("Credential input exceeds the limit.");
    }
    const lines = input.replace(/\r\n/g, "\n").split("\n");
    if (lines.length < 2 || lines.slice(2).some((line) => line.length))
      throw new Error("Provide email and password as two stdin lines.");
    [email, password] = lines;
  }
  const user = await createUser(z.email().parse(email), password);
  console.log(`Created ${user.email}`);
} finally {
  await db.$disconnect();
}
