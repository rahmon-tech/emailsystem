import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampAdaptiveSlowdown,
  effectiveProviderPerMinute,
  providerPressure,
} from "@emailsystem/core/provider-pacing-telemetry";

test("adaptive slowdown is bounded and converts configured rate to an effective rate", () => {
  assert.equal(clampAdaptiveSlowdown(null), 1);
  assert.equal(clampAdaptiveSlowdown("0.2"), 1);
  assert.equal(clampAdaptiveSlowdown("2.5"), 2.5);
  assert.equal(clampAdaptiveSlowdown("99"), 4);
  assert.equal(clampAdaptiveSlowdown("not-a-number"), 1);
  assert.equal(effectiveProviderPerMinute(120, 1), 120);
  assert.equal(effectiveProviderPerMinute(120, 2.5), 48);
  assert.equal(effectiveProviderPerMinute(3, 4), 1);
});

test("provider pressure prioritizes disabled, policy block, cooldown, then adaptive slowdown", () => {
  const now = Date.now();
  assert.equal(
    providerPressure(
      { enabled: false, health: "HEALTHY", cooldownUntil: null },
      4,
      now,
    ),
    "disabled",
  );
  assert.equal(
    providerPressure(
      { enabled: true, health: "POLICY_BLOCKED", cooldownUntil: null },
      4,
      now,
    ),
    "blocked",
  );
  assert.equal(
    providerPressure(
      {
        enabled: true,
        health: "HEALTHY",
        cooldownUntil: new Date(now + 60_000),
      },
      4,
      now,
    ),
    "cooldown",
  );
  assert.equal(
    providerPressure(
      { enabled: true, health: "HEALTHY", cooldownUntil: null },
      1.5,
      now,
    ),
    "slowed",
  );
  assert.equal(
    providerPressure(
      { enabled: true, health: "HEALTHY", cooldownUntil: null },
      1,
      now,
    ),
    "normal",
  );
});
