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
};

type ProviderStatus = {
  scopedProviderCount: number;
  eligibleProviderCount: number;
  campaignBlockReason: string | null;
  providers: ProviderRow[];
};

function pressureLabel(row: ProviderRow) {
  if (row.pressure === "blocked") return "Policy review";
  if (row.pressure === "cooldown") return "Cooling down";
  if (row.pressure === "slowed") return `${row.slowdown}× slowdown`;
  if (row.pressure === "disabled") return "Disabled";
  return "Normal pace";
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
      aria-label="Campaign provider availability"
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
              Live provider availability
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Campaign scope, sender authorization, capability, quota and safety budget are applied before pacing chooses a transport slot.
            </Typography>
          </Box>
        </Stack>
        <Chip
          size="small"
          sx={{ ml: { sm: "auto" } }}
          label={`${status.eligibleProviderCount} of ${status.scopedProviderCount} eligible`}
        />
      </Stack>

      {status.campaignBlockReason && (
        <Alert severity="warning">{status.campaignBlockReason}</Alert>
      )}

      {!status.providers.length ? (
        <Typography variant="body2" color="text.secondary">
          No sender-authorized providers are inside this campaign's current scope.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {status.providers.map((provider) => (
            <Box
              key={provider.id}
              sx={{ py: 1.25, borderTop: 1, borderColor: "divider" }}
            >
              <Stack
                direction={{ xs: "column", sm: "row" }}
                sx={{ gap: 1, alignItems: { xs: "flex-start", sm: "center" } }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 650 }}>
                    {provider.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Configured {provider.configuredPerMinute.toLocaleString()}/min · effective {provider.effectivePerMinute.toLocaleString()}/min
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
                    label={provider.eligible ? "Eligible" : "Unavailable"}
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
                  Next provider slot {new Date(provider.nextAllowedAt).toLocaleTimeString()}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
