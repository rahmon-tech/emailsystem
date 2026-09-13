export type DeliveryEventSupport = "supported" | "unavailable";

export function recipientDeliveryPresentationState(
  state: string,
  provider: { transport: string; deliveryEvents: DeliveryEventSupport } | null,
) {
  if (state !== "PROVIDER_ACCEPTED") return state;
  if (provider?.transport === "smtp")
    return provider.deliveryEvents === "supported"
      ? "SMTP_ACCEPTED_AWAITING_CONFIRMATION"
      : "SMTP_ACCEPTED_UNCONFIRMED";
  return "PROVIDER_ACCEPTED_AWAITING_CONFIRMATION";
}
