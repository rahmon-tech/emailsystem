import { test } from "node:test";
import assert from "node:assert/strict";
import { absoluteUrlFromRoot } from "../packages/core/src/paths";

test("absolute application URLs preserve arbitrary base paths exactly once", () => {
  assert.equal(
    absoluteUrlFromRoot("https://app.example.com/emailblast", "/r/token"),
    "https://app.example.com/emailblast/r/token",
  );
  assert.equal(
    absoluteUrlFromRoot(
      "https://app.example.com/tools/email",
      "/unsubscribe/token",
    ),
    "https://app.example.com/tools/email/unsubscribe/token",
  );
  assert.equal(
    absoluteUrlFromRoot("https://mail.example.com", "/api/webhooks/resend"),
    "https://mail.example.com/api/webhooks/resend",
  );
  assert.throws(() =>
    absoluteUrlFromRoot(
      "https://app.example.com/emailblast",
      "emailblast/r/token",
    ),
  );
});
