import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeEndpointWarnings,
  validateNativeBootstrapEnv,
  versionAtLeast,
} from "../scripts/native-bootstrap.ts";

const valid = {
  NODE_ENV: "production",
  APP_URL: "https://app.example.com/emailblast",
  NEXT_PUBLIC_BASE_PATH: "/emailblast",
  DATABASE_URL: "postgresql://emailsystem:password@127.0.0.1:5432/emailsystem",
  REDIS_URL: "redis://127.0.0.1:6379",
  SESSION_SECRET: "a".repeat(64),
  CREDENTIAL_ENCRYPTION_KEY: "b".repeat(64),
};

test("native bootstrap enforces the supported Node floor", () => {
  assert.equal(versionAtLeast("22.12.0", "22.12.0"), true);
  assert.equal(versionAtLeast("22.11.9", "22.12.0"), false);
  assert.equal(versionAtLeast("24.19.0", "22.12.0"), true);
});

test("native bootstrap validates production URL, base path and secrets", () => {
  assert.doesNotThrow(() => validateNativeBootstrapEnv(valid));
  assert.throws(
    () =>
      validateNativeBootstrapEnv({
        ...valid,
        APP_URL: "https://app.example.com/other",
      }),
    /APP_URL path must match NEXT_PUBLIC_BASE_PATH/,
  );
  assert.throws(
    () =>
      validateNativeBootstrapEnv({
        ...valid,
        APP_URL: "http://app.example.com/emailblast",
      }),
    /Production APP_URL must use HTTPS/,
  );
  assert.throws(
    () => validateNativeBootstrapEnv({ ...valid, SESSION_SECRET: "short" }),
    /SESSION_SECRET/,
  );
});

test("native bootstrap warns when Docker-only service names are used", () => {
  assert.deepEqual(nativeEndpointWarnings(valid), []);
  assert.deepEqual(
    nativeEndpointWarnings({
      ...valid,
      DATABASE_URL: "postgresql://emailsystem:password@postgres:5432/emailsystem",
      REDIS_URL: "redis://redis:6379",
    }),
    [
      "DATABASE_URL uses host 'postgres', which is normally a Docker Compose service name rather than a native host address.",
      "REDIS_URL uses host 'redis', which is normally a Docker Compose service name rather than a native host address.",
    ],
  );
});
