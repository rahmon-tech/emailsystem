import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  recoverySettings,
  isRecoveryCodeValid,
} from "../packages/core/src/account-recovery-config.ts";
import { digest } from "../packages/core/src/security.ts";

const now = Date.UTC(2026, 10, 24, 15, 0, 0);
const code = randomBytes(32).toString("base64url");
const validConfig = {
  ACCOUNT_RECOVERY_EMAIL: " Owner@Example.com ",
  ACCOUNT_RECOVERY_CODE_SHA256: digest(code),
  ACCOUNT_RECOVERY_EXPIRES_AT: String(now + 20 * 60 * 1000),
};

test("recovery is opt-in, expires, and never accepts broad grants", () => {
  assert.equal(recoverySettings({}, now), null);
  assert.equal(recoverySettings(validConfig, now + 21 * 60 * 1000), null);
  assert.equal(
    recoverySettings({
      ...validConfig,
      ACCOUNT_RECOVERY_EXPIRES_AT: String(now + 2 * 60 * 60 * 1000),
    }, now),
    null,
  );
  assert.equal(
    recoverySettings({ ...validConfig, ACCOUNT_RECOVERY_CODE_SHA256: "" }, now),
    null,
  );
});

test("only a valid exact code matches its restricted account", () => {
  const settings = recoverySettings(validConfig, now);
  assert(settings);
  assert.equal(settings.email, "owner@example.com");
  assert(isRecoveryCodeValid(code, settings));
  assert.equal(isRecoveryCodeValid(randomBytes(32).toString("base64url"), settings), false);
  assert.equal(isRecoveryCodeValid("123456", settings), false);
  assert.equal(isRecoveryCodeValid(code + "a", settings), false);
});
