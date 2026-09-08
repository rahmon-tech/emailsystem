import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encryptSecret,
  decryptSecret,
  hashPassword,
  checkPassword,
  makeSignedToken,
  verifySignedToken,
  csvCell,
  maskEmail,
} from "../packages/core/src/security.ts";
const key = Buffer.alloc(32, 17).toString("hex");
test("credentials are authenticated and bound to their owning connection", () => {
  const a = encryptSecret(
    { apiKey: "private-secret" },
    key,
    "user-a:provider-1",
  );
  assert(!JSON.stringify(a).includes("private-secret"));
  assert.deepEqual(decryptSecret(a, key, "user-a:provider-1"), {
    apiKey: "private-secret",
  });
  assert.throws(() => decryptSecret(a, key, "user-b:provider-1"));
  assert.throws(() =>
    decryptSecret(
      { ...a, tag: Buffer.alloc(16).toString("base64") },
      key,
      "user-a:provider-1",
    ),
  );
  assert.notEqual(a.iv, encryptSecret({}, key, "user-a:provider-1").iv);
});
test("passwords use salted expensive hashes and reject malformed input", async () => {
  const hash = await hashPassword("correct-horse-battery-staple");
  assert(await checkPassword("correct-horse-battery-staple", hash));
  assert.equal(await checkPassword("wrong", hash), false);
  assert.equal(await checkPassword("x", "bad"), false);
  assert.notEqual(hash, await hashPassword("correct-horse-battery-staple"));
});
test("unsubscribe tokens reject forgery and do not contain internal IDs", () => {
  const token = makeSignedToken(key);
  assert(verifySignedToken(token, key));
  assert.equal(verifySignedToken(token + "x", key), false);
  assert.equal(
    verifySignedToken(token, Buffer.alloc(32, 9).toString("hex")),
    false,
  );
});
test("CSV export neutralizes formulas and activity masks addresses", () => {
  assert.equal(csvCell('=WEBSERVICE("secret")'), '"\'=WEBSERVICE(""secret"")"');
  assert.equal(csvCell("\t+SUM(1,2)"), '"\'\t+SUM(1,2)"');
  assert.equal(maskEmail("john@example.com"), "jo•••@example.com");
});
