import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkReputation,
  canonicalDomain,
  isDeniedDomain,
} from "@emailsystem/core/reputation";
import { likelyAutomated, trackingSettings } from "@emailsystem/core/tracking";
const url = new URL("https://example.com/path?private=query");
test("reputation absence, outage and timeout are unknown; blocked results dominate", async () => {
  assert.equal(
    (await checkReputation(url, "owner", [])).state,
    "REPUTATION_UNKNOWN",
  );
  assert.equal(
    (
      await checkReputation(url, "owner", [
        {
          id: "unavailable",
          async check() {
            throw new Error("outage");
          },
        },
      ])
    ).state,
    "REPUTATION_UNKNOWN",
  );
  let signal: AbortSignal | undefined;
  assert.equal(
    (
      await checkReputation(
        url,
        "owner",
        [
          {
            id: "timeout",
            async check(_, ctx) {
              assert.equal(ctx.userId, "owner");
              signal = ctx.signal;
              return new Promise(() => {});
            },
          },
        ],
        5,
      )
    ).state,
    "REPUTATION_UNKNOWN",
  );
  assert(signal?.aborted);
  assert.equal(
    (
      await checkReputation(url, "owner", [
        {
          id: "affirmative",
          async check() {
            return "REPUTATION_CLEAN";
          },
        },
      ])
    ).state,
    "REPUTATION_CLEAN",
  );
  assert.equal(
    (
      await checkReputation(
        url,
        "owner",
        [
          {
            id: "blocked",
            async check() {
              return "REPUTATION_BLOCKED";
            },
          },
          {
            id: "timeout",
            async check() {
              return new Promise(() => {});
            },
          },
        ],
        5,
      )
    ).state,
    "REPUTATION_BLOCKED",
  );
});
test("denied domains match exact DNS boundaries and tracking remains opt-in", () => {
  assert.equal(canonicalDomain(" EXAMPLE.COM. "), "example.com");
  assert(isDeniedDomain("sub.example.com", ["example.com"]));
  assert(isDeniedDomain("EXAMPLE.com.", ["example.com"]));
  assert(!isDeniedDomain("notexample.com", ["example.com"]));
  assert(!isDeniedDomain("example.com.attacker.com", ["example.com"]));
  assert.throws(() => canonicalDomain("https://example.com/path"));
  assert.deepEqual(trackingSettings.parse({}), {
    defaultEnabled: false,
    blockUnknown: false,
  });
});
test("scanner classification is a coarse heuristic; ordinary visits remain unclassified", () => {
  assert(likelyAutomated(new Request(url, { method: "HEAD" })));
  assert(
    likelyAutomated(
      new Request(url, { headers: { "user-agent": "Proofpoint URL scanner" } }),
    ),
  );
  assert(
    likelyAutomated(
      new Request(url, { headers: { "sec-purpose": "prefetch" } }),
    ),
  );
  assert(
    !likelyAutomated(
      new Request(url, { headers: { "user-agent": "Mozilla/5.0" } }),
    ),
  );
});
