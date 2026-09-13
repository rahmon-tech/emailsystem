"use client";
import { Stack, Tooltip, Typography } from "@mui/material";
import { date } from "./api-client";

type DeliveryStatusContext = {
  acceptedAt?: string | null;
  deliveredAt?: string | null;
  provider?: {
    name: string;
    type: string;
    transport: string;
    deliveryEvents: "supported" | "unavailable";
  } | null;
};

export function DeliveryStatusDetail({
  delivery,
}: {
  delivery: DeliveryStatusContext;
}) {
  const provider = delivery.provider;

  if (delivery.deliveredAt)
    return (
      <Tooltip title="Confirmed by an authenticated provider delivery event. This does not mean the recipient opened or read the message.">
        <Typography color="success.main" sx={{ fontSize: 12, mt: 0.5 }}>
          Delivery confirmed {date(delivery.deliveredAt)}
          {provider ? ` · ${provider.name}` : ""}
        </Typography>
      </Tooltip>
    );

  if (!delivery.acceptedAt) {
    if (!provider) return null;
    return (
      <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5 }}>
        {provider.name} · {provider.transport.toUpperCase()}
      </Typography>
    );
  }

  const smtp = provider?.transport === "smtp";
  const confirmationUnavailable =
    smtp && provider?.deliveryEvents === "unavailable";

  return (
    <Stack sx={{ mt: 0.5 }}>
      <Typography color="text.secondary" sx={{ fontSize: 12 }}>
        {smtp ? "SMTP accepted" : "Provider accepted"} {date(delivery.acceptedAt)}
        {provider ? ` · ${provider.name}` : ""}
      </Typography>
      <Tooltip
        title={
          confirmationUnavailable
            ? "A successful SMTP response confirms handoff to the SMTP server, not final mailbox delivery. This connection does not provide authenticated delivery events."
            : "EmailSystem will change this recipient to Delivered only after an authenticated provider delivery event is received."
        }
      >
        <Typography color="text.secondary" sx={{ fontSize: 11.5 }}>
          {confirmationUnavailable
            ? "Delivery confirmation unavailable for this SMTP connection."
            : "Awaiting delivery confirmation."}
        </Typography>
      </Tooltip>
    </Stack>
  );
}
