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
      "Sending pattern: small groups",
      "Group window: 12s",
      "Group size: 4",
      "Emails at once: 3",
      "Email format: base64",
      "Character support: UTF-8",
      "Message type: Web-hosted image",
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
      "Sending pattern: steady",
      "Email format: Automatic",
      "Character support: UTF-8",
      "Message type: HTML email",
    ],
  );
});