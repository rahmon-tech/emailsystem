export type CampaignStatus =
  | "DRAFT"
  | "PREPARING"
  | "QUEUED"
  | "SENDING"
  | "PAUSED"
  | "CANCELLING"
  | "CANCELLED"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "FAILED";
export type DeliveryStatus =
  | "PENDING"
  | "QUEUED"
  | "PROCESSING"
  | "PROVIDER_ACCEPTED"
  | "DELIVERED"
  | "DEFERRED"
  | "SOFT_BOUNCED"
  | "HARD_BOUNCED"
  | "FAILED"
  | "COMPLAINED"
  | "UNSUBSCRIBED"
  | "SUPPRESSED"
  | "CANCELLED"
  | "UNKNOWN";
export type EventKind =
  | "accepted"
  | "delivered"
  | "deferred"
  | "soft_bounce"
  | "hard_bounce"
  | "failed"
  | "complaint"
  | "unsubscribe"
  | "open"
  | "click";
export type ErrorCategory =
  | "temporary"
  | "permanent"
  | "authentication"
  | "authorization"
  | "rate_limit"
  | "policy"
  | "sender_configuration"
  | "unknown";
export const unclaimedStates: DeliveryStatus[] = [
  "PENDING",
  "QUEUED",
  "DEFERRED",
];
export function transitionCampaign(
  state: CampaignStatus,
  action: "pause" | "resume" | "cancel",
): CampaignStatus {
  if (action === "pause" && ["QUEUED", "SENDING"].includes(state))
    return "PAUSED";
  if (action === "resume" && state === "PAUSED") return "QUEUED";
  if (
    action === "cancel" &&
    ["DRAFT", "PREPARING", "QUEUED", "SENDING", "PAUSED"].includes(state)
  )
    return "CANCELLING";
  throw new Error("This campaign action is not available in its current state");
}
const negative: DeliveryStatus[] = [
  "HARD_BOUNCED",
  "COMPLAINED",
  "UNSUBSCRIBED",
  "SUPPRESSED",
];
export function deliveryAfterEvent(
  state: DeliveryStatus,
  kind: EventKind,
): DeliveryStatus {
  if (["CANCELLED", "SUPPRESSED"].includes(state)) return state;
  if (kind === "complaint") return "COMPLAINED";
  if (state === "COMPLAINED") return state;
  if (kind === "unsubscribe") return "UNSUBSCRIBED";
  if (negative.includes(state)) return state;
  if (kind === "hard_bounce") return "HARD_BOUNCED";
  if (kind === "delivered") return "DELIVERED";
  if (state === "DELIVERED") return state;
  if (kind === "failed") return "FAILED";
  if (kind === "soft_bounce") return "SOFT_BOUNCED";
  // Provider deferrals are provider-owned; never re-enqueue a message already accepted.
  if (kind === "deferred") return state;
  if (kind === "accepted") return "PROVIDER_ACCEPTED";
  return state;
}
export function retryDecision(
  category: ErrorCategory,
  attempt: number,
): number | "fail" | "reconcile" | "block" {
  if (category === "unknown") return "reconcile";
  if (category === "policy") return "block";
  if (!["temporary", "rate_limit"].includes(category) || attempt >= 5)
    return "fail";
  return (
    Math.min(3600000, 15000 * 2 ** (attempt - 1)) +
    Math.floor(Math.random() * 5000)
  );
}
