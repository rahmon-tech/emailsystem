import { test } from "node:test";
import assert from "node:assert/strict";
import { experimentConfigurationLabels } from "../apps/web/components/activity-experiment-model.ts";

test("experiment Activity labels approved configuration without claiming metadata-only effectiveness", () => {
  assert.deepEqual(
    experimentConfigurationLabels({
      pacingProfile: "bounded-burst",
      pacingIntervalMs: 12_000,
      pacingBurstSize: 4,
      concurrency: 3,
      transportEncoding: "base64",
      charset: "utf-8",
      contentMode: "hosted-image",
    }),
    [
      "Pacing: bounded burst",
      "Window: 12s",
      "Burst: 4",
      "Concurrency: 3",
      "Encoding: base64",
      "Charset: UTF-8",
      "Requested content: hosted image",
    ],
  );
});

test("experiment Activity omits unset optional controls and formats smooth pacing", () => {
  assert.deepEqual(
    experimentConfigurationLabels({
      pacingProfile: "smooth",
      transportEncoding: "provider-default",
      charset: "utf-8",
      contentMode: "html",
    }),
    [
      "Pacing: smooth",
      "Encoding: provider default",
      "Charset: UTF-8",
      "Requested content: html",
    ],
  );
});