// Sending-domain safety is distinct from domain DNS/API verification.
// A paused domain stays blocked across campaigns, providers and From aliases.
export function campaignSendingDomains(message: unknown): string[] {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return [];
  const value = message as Record<string, unknown>;
  const pool =
    value.senderPool && typeof value.senderPool === "object" &&
    !Array.isArray(value.senderPool)
      ? (value.senderPool as Record<string, unknown>)
      : null;
  const configured = Array.isArray(pool?.domains) ? pool.domains : [];
  const from = typeof value.from === "string" ? value.from : "";
  const fallback = from.includes("@") ? from.split("@").at(-1) : "";
  return [
    ...new Set(
      [...configured, fallback]
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim().toLowerCase())
        .filter((name) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(name)),
    ),
  ];
}
export function domainBounceReason(domain: string, kind: "complaint" | "hard_bounce") {
  return `${kind === "complaint" ? "Complaint" : "Hard bounce"} safety threshold reached for ${domain} · administrator review required`;
}
