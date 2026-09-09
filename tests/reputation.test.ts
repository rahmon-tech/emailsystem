import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkReputation,
  canonicalDomain,
  isDeniedDomain,
} from "@emailsystem/core/reputation";
import { likelyAutomated, trackingSettings } from "@emailsystem/core/tracking";
import { verifiedPublicAddress } from "@emailsystem/core/tracking-verification";
import { Resolver } from "node:dns/promises";
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
    defaultDomainId: null,
    blockUnknown: false,
  });
});
test("ownership checks reject private, mixed and absent DNS addresses before HTTPS can connect", async () => {
  const resolver = (
    addresses: string[],
    txt = "emailblast-verification=proof",
  ) =>
    ({
      async resolveTxt() {
        return [[txt]];
      },
      async resolve4() {
        return addresses;
      },
      async resolve6() {
        return [];
      },
    }) as unknown as Pick<Resolver, "resolveTxt" | "resolve4" | "resolve6">;
  for (const addresses of [
    [],
    ["127.0.0.1"],
    ["10.0.0.1"],
    ["169.254.169.254"],
    ["8.8.8.8", "192.168.1.1"],
  ])
    assert.equal(
      await verifiedPublicAddress(
        "click.example.com",
        "proof",
        resolver(addresses),
      ),
      false,
    );
  assert.equal(
    await verifiedPublicAddress(
      "click.example.com",
      "proof",
      resolver(["8.8.8.8"], "different-owner"),
    ),
    false,
  );
  assert.deepEqual(
    await verifiedPublicAddress(
      "click.example.com",
      "proof",
      resolver(["8.8.8.8"]),
    ),
    { address: "8.8.8.8", family: 4 },
  );
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
