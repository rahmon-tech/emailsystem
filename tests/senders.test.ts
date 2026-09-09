import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalLocalPart,
  senderEmail,
  authorizationAllowsSender,
} from "../packages/core/src/senders";

test("sender identities are deterministic and reject unsafe local parts", () => {
  assert.equal(canonicalLocalPart(" Sales "), "sales");
  assert.equal(
    senderEmail("News.Lagos", "Example.COM"),
    "news.lagos@example.com",
  );
  for (const value of ["", ".sales", "sales.", "two@@names", "name\r\nbcc"])
    assert.throws(() => canonicalLocalPart(value));
  assert.throws(() => senderEmail("two..dots", "example.com"));
});

test("domain-wide and address-specific authorization remain explicit", () => {
  const sender = { id: "sender-1" };
  assert(
    authorizationAllowsSender(
      { status: "VERIFIED", scope: "DOMAIN_WIDE", senderAuthorizations: [] },
      sender,
    ),
  );
  assert(
    authorizationAllowsSender(
      {
        status: "VERIFIED",
        scope: "ADDRESS_SPECIFIC",
        senderAuthorizations: [{ senderIdentityId: "sender-1" }],
      },
      sender,
    ),
  );
  assert(
    !authorizationAllowsSender(
      {
        status: "VERIFIED",
        scope: "ADDRESS_SPECIFIC",
        senderAuthorizations: [{ senderIdentityId: "someone-else" }],
      },
      sender,
    ),
  );
  assert(
    !authorizationAllowsSender(
      { status: "UNVERIFIED", scope: "DOMAIN_WIDE", senderAuthorizations: [] },
      sender,
    ),
  );
});
