import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cookieTokensFromHeader,
  sessionCookie,
  sessionCookiePath,
  sessionCookieValue,
  sessionMaxAgeSeconds,
} from "../packages/core/src/auth";

test("session cookie matches the 30-day database session and is reload-safe", () => {
  const token = "a".repeat(43);
  const value = sessionCookieValue(token);
  assert.equal(sessionMaxAgeSeconds, 30 * 86400);
  assert.match(value, new RegExp(`^${sessionCookie}=${token};`));
  assert.match(value, new RegExp(`Path=${sessionCookiePath().replaceAll("/", "\\/")}`));
  assert.match(value, /Max-Age=2592000/);
  assert.match(value, /Expires=/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Lax/);
  assert.match(value, /Priority=High/);
});

test("duplicate legacy cookies do not hide the current session token", () => {
  const stale = "s".repeat(43);
  const current = "c".repeat(43);
  assert.deepEqual(
    cookieTokensFromHeader(
      `other=x; ${sessionCookie}=${stale}; ${sessionCookie}=${current}; ignored=1`,
    ),
    [stale, current],
  );
});
