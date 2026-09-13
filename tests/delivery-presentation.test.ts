import test from "node:test";
import assert from "node:assert/strict";
import { recipientDeliveryPresentationState } from "@emailsystem/core/delivery-presentation";

test("recipient delivery presentation keeps SMTP acceptance distinct from delivery", () => {
  assert.equal(
    recipientDeliveryPresentationState("PROVIDER_ACCEPTED", {
      transport: "smtp",
      deliveryEvents: "unavailable",
    }),
    "SMTP_ACCEPTED_UNCONFIRMED",
  );
  assert.equal(
    recipientDeliveryPresentationState("PROVIDER_ACCEPTED", {
      transport: "smtp",
      deliveryEvents: "supported",
    }),
    "SMTP_ACCEPTED_AWAITING_CONFIRMATION",
  );
  assert.equal(
    recipientDeliveryPresentationState("PROVIDER_ACCEPTED", {
      transport: "api",
      deliveryEvents: "supported",
    }),
    "PROVIDER_ACCEPTED_AWAITING_CONFIRMATION",
  );
  assert.equal(
    recipientDeliveryPresentationState("DELIVERED", {
      transport: "smtp",
      deliveryEvents: "supported",
    }),
    "DELIVERED",
  );
  assert.equal(
    recipientDeliveryPresentationState("HARD_BOUNCED", null),
    "HARD_BOUNCED",
  );
});
