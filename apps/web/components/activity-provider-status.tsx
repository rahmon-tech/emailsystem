"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Box, Chip, Stack, Typography } from "@mui/material";
import { SpeedOutlined } from "@mui/icons-material";
import { api } from "./api-client";

type ProviderRow = {
  id: string;
  name: string;
  health: string;
  enabled: boolean;
  configuredPerMinute: number;
  effectivePerMinute: number;
  slowdown: number;
  cooldownUntil: string | null;
  nextAllowedAt: string | null;
  pressure: "disabled" | "blocked" | "cooldown" | "slowed" | "normal";
  eligible: boolean;
  unavailableReason: string | null;
  quotaRemaining: number | null;
  safetyRemaining: number | null;
  monthlySafetyRemaining: number | null;
  monthlyUsed: number;
  monthlyLimit: number | null;
  domain: string;
};

type ProviderStatus = {
  scopedProviderCount: number;
  eligibleProviderCount: number;
  campaignBlockReason: string | null;
  providers: ProviderRow[];
};

function pressureLabel(row: ProviderRow) {
  if (row.pressure === "blocked") return "Needs review";
  if (row.pressure === "cooldown") return "Temporarily paused";
  if (row.pressure === "slowed") return "Sending slower";
  if (row.pressure === "disabled") return "Turned off";
  return "Normal speed";
}

export function ActivityProviderStatus() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [result, setResult] = useState<
    { campaignId: string; status: ProviderStatus } | null
  >(null);

  useEffect(() => {
    let live = true;
    if (!campaignId) return;
    const refresh = () =>
      void api<ProviderStatus>(`campaigns/${campaignId}/provider-status`)
        .then((status) => {
          if (live) setResult({ campaignId, status });
        })
        .catch(() => {
          /* Keep the last known provider status during a transient refresh failure. */
        });
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [campaignId]);

  if (!campaignId || result?.campaignId !== campaignId) return null;
  const status = result.status;

  return (
    <Stack
      component="section"
      spacing={1.5}
      aria-label="Sending connection availability"
      sx={{ mb: 2, p: { xs: 1.75, sm: 2 }, border: 1, borderColor: "divider", borderRadius: 2 }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{ gap: 1, alignItems: { xs: "flex-start", sm: "center" } }}
      >
        <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
          <SpeedOutlined sx={{ fontSize: 18 }} />
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
              Sending connections
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Shows which provider and domain connections this campaign can use right now.
            </Typography>
          </Box>
        </Stack>
        <Chip
          size="small"
          sx={{ ml: { sm: "auto" } }}
          label={`${status.eligibleProviderCount} of ${status.scopedProviderCount} ready`}
        />
      </Stack>

      {status.campaignBlockReason && (
        <Alert severity="warning">{status.campaignBlockReason}</Alert>
      )}

      {!status.providers.length ? (
        <Typography variant="body2" color="text.secondary">
          No sending connection is currently available for this campaign.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {status.providers.map((provider) => (
            <Box
              key={`${provider.id}:${provider.domain}`}
              sx={{ py: 1.25, borderTop: 1, borderColor: "divider" }}
            >
              <Stack
                direction={{ xs: "column", sm: "row" }}
                sx={{ gap: 1, alignItems: { xs: "flex-start", sm: "center" } }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 650 }}>
                    {provider.name} · {provider.domain}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {provider.effectivePerMinute.toLocaleString()} emails/min
                    {provider.effectivePerMinute !== provider.configuredPerMinute
                      ? ` · limit ${provider.configuredPerMinute.toLocaleString()}/min`
                      : ""}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.25 }}
                  >
                    24h capacity{" "}
                    {provider.safetyRemaining === null
                      ? "no extra limit"
                      : `${provider.safetyRemaining.toLocaleString()} left`}{" "}
                    · This month{" "}
                    {provider.monthlyLimit === null
                      ? "no extra limit"
                      : `${provider.monthlyUsed.toLocaleString()} of ${provider.monthlyLimit.toLocaleString()} used`}
                  </Typography>
                  {provider.unavailableReason && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.25 }}
                    >
                      {provider.unavailableReason}
                    </Typography>
                  )}
                </Box>
                <Stack
                  direction="row"
                  sx={{ gap: 0.75, flexWrap: "wrap", alignItems: "center" }}
                >
                  <Chip
                    size="small"
                    label={provider.eligible ? "Ready" : "Unavailable"}
                  />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={pressureLabel(provider)}
                  />
                </Stack>
              </Stack>
              {provider.nextAllowedAt && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  Can try again at {new Date(provider.nextAllowedAt).toLocaleTimeString()}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
