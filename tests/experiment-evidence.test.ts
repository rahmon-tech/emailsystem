import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalEvidenceJson,
  experimentEvidenceHash,
  experimentRecipientHash,
  verifyExperimentEvidenceEntries,
} from "@emailsystem/core/experiment-evidence";

test("experiment evidence canonicalization is stable and recipient identifiers are scoped", () => {
  assert.equal(
    canonicalEvidenceJson({ b: 2, a: { d: 4, c: 3 } }),
    canonicalEvidenceJson({ a: { c: 3, d: 4 }, b: 2 }),
  );
  assert.equal(
    experimentRecipientHash("run-a", "USER@Example.com"),
    experimentRecipientHash("run-a", "user@example.com"),
  );
  assert.notEqual(
    experimentRecipientHash("run-a", "user@example.com"),
    experimentRecipientHash("run-b", "user@example.com"),
  );
});

test("experiment evidence chain verifies and detects payload tampering", () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const firstAt = new Date("2026-09-13T12:00:00.000Z");
  const secondAt = new Date("2026-09-13T12:00:05.000Z");
  const firstPayload = { status: "started", provider: { perMinute: 120 } };
  const firstHash = experimentEvidenceHash({
    runId,
    sequence: 1,
    kind: "transport.started",
    attemptId: "attempt-1",
    providerId: "provider-1",
    campaignId: "campaign-1",
    previousHash: "GENESIS",
    createdAt: firstAt,
    payload: firstPayload,
  });
  const secondPayload = { status: "accepted", providerMessageId: "message-1" };
  const secondHash = experimentEvidenceHash({
    runId,
    sequence: 2,
    kind: "transport.outcome",
    attemptId: "attempt-1",
    providerId: "provider-1",
    campaignId: "campaign-1",
    previousHash: firstHash,
    createdAt: secondAt,
    payload: secondPayload,
  });
  const entries = [
    {
      runId,
      sequence: 1,
      kind: "transport.started",
      attemptId: "attempt-1",
      providerId: "provider-1",
      campaignId: "campaign-1",
      payload: firstPayload,
      previousHash: "GENESIS",
      hash: firstHash,
      createdAt: firstAt,
    },
    {
      runId,
      sequence: 2,
      kind: "transport.outcome",
      attemptId: "attempt-1",
      providerId: "provider-1",
      campaignId: "campaign-1",
      payload: secondPayload,
      previousHash: firstHash,
      hash: secondHash,
      createdAt: secondAt,
    },
  ];
  assert.deepEqual(verifyExperimentEvidenceEntries(entries), {
    valid: true,
    count: 2,
    verifiedThrough: 2,
    headHash: secondHash,
  });
  assert.equal(
    verifyExperimentEvidenceEntries([
      entries[0]!,
      { ...entries[1]!, payload: { status: "rejected" } },
    ]).valid,
    false,
  );
});
