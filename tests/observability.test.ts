import test from "node:test";
import assert from "node:assert/strict";
import {
  logEvent,
  newCorrelationId,
  serializeError,
} from "@emailsystem/core/errors";
import { errorResponse } from "@emailsystem/core/http";

test("structured logs carry levels and redact sensitive fields and error text", { concurrency: false }, () => {
  const original = console.error;
  let line = "";
  console.error = (...args: unknown[]) => {
    line = args.map(String).join(" ");
  };
  try {
    logEvent(
      "error",
      "provider.request.failed",
      {
        correlationId: "corr-12345678",
        providerId: "provider-123",
        recipientEmail: "person@example.com",
        apiKey: "secret-value",
        detail: "request token=hidden-value for person@example.com",
      },
      new Error("Bearer very-secret-token failed for person@example.com"),
    );
  } finally {
    console.error = original;
  }

  const record = JSON.parse(line) as Record<string, unknown> & {
    error: { message: string };
  };
  assert.equal(record.level, "error");
  assert.equal(record.event, "provider.request.failed");
  assert.equal(record.correlationId, "corr-12345678");
  assert.equal(record.providerId, "provider-123");
  assert.equal(record.recipientEmail, "[redacted]");
  assert.equal(record.apiKey, "[redacted]");
  assert.doesNotMatch(String(record.detail), /person@example\.com|hidden-value/);
  assert.doesNotMatch(record.error.message, /person@example\.com|very-secret-token/);
  assert.match(String(record.time), /^\d{4}-\d{2}-\d{2}T/);
});

test("error serialization keeps safe type/code context without stack leakage", () => {
  const error = Object.assign(
    new Error("smtp password=hunter2 for sender@example.com"),
    { code: "ECONNECTION" },
  );
  const serialized = serializeError(error);
  assert.equal(serialized.name, "Error");
  assert.equal(serialized.code, "ECONNECTION");
  assert.doesNotMatch(serialized.message, /hunter2|sender@example\.com/);
  assert.equal("stack" in serialized, false);
});

test("internal HTTP failures return the same safe support reference emitted to logs", { concurrency: false }, async () => {
  const original = console.error;
  let line = "";
  console.error = (...args: unknown[]) => {
    line = args.map(String).join(" ");
  };
  let response: Response;
  try {
    response = errorResponse(
      new Error("upstream token=private-value for customer@example.com"),
    );
  } finally {
    console.error = original;
  }

  assert.equal(response.status, 500);
  const correlationId = response.headers.get("x-correlation-id");
  assert.ok(correlationId);
  const body = (await response.json()) as {
    code: string;
    supportRef: string;
    error: string;
  };
  assert.equal(body.code, "INTERNAL");
  assert.equal(body.supportRef, correlationId);
  assert.equal(body.error, "The request could not be completed. Please try again.");

  const record = JSON.parse(line) as {
    correlationId: string;
    error: { message: string };
  };
  assert.equal(record.correlationId, correlationId);
  assert.doesNotMatch(record.error.message, /private-value|customer@example\.com/);
});

test("correlation identifiers preserve safe upstream references and reject unsafe text", () => {
  assert.equal(newCorrelationId("request-12345678"), "request-12345678");
  const generated = newCorrelationId("unsafe value with spaces");
  assert.match(
    generated,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});
