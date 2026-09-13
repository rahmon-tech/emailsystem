"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Box, Card, Chip, Stack, Tooltip, Typography } from "@mui/material";
import { ScheduleOutlined, SpeedOutlined } from "@mui/icons-material";
import { api } from "./api-client";

type Pacing = {
  status: "complete" | "waiting" | "estimating" | "active";
  sampleSize: number;
  remaining: number;
  messagesPerMinute: number | null;
  estimatedSeconds: number | null;
  observedSeconds: number;
  idleSeconds: number | null;
  campaignState: string;
  safetyWaitUntil: string | null;
  safetyWaitReason: string | null;
  observedWindowSeconds: number;
};

function duration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds <= 0) return "Done";
  if (seconds < 60) return "< 1 min";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `~${hours}h ${rest}m` : `~${hours}h`;
}

function detail(pacing: Pacing) {
  if (pacing.campaignState === "PAUSED") return "Campaign is paused.";
  if (pacing.safetyWaitReason) return pacing.safetyWaitReason;
  if (pacing.status === "complete") return "No recipients remain in the dispatch queue.";
  if (pacing.status === "waiting")
    return pacing.sampleSize
      ? "Dispatch is currently idle, so the previous pace is not used for ETA."
      : "Waiting for enough real dispatch activity to measure pace.";
  if (pacing.status === "estimating")
    return "Collecting a little more dispatch history before showing ETA.";
  return "ETA is based on recent transport starts and can change with provider cooldowns, limits, retries, or safety controls.";
}

export function ActivityPacing() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [pacing, setPacing] = useState<Pacing | null>(null);

  useEffect(() => {
    let live = true;
    if (!campaignId) {
      setPacing(null);
      return;
    }
    const refresh = () =>
      void api<Pacing>(`campaigns/${campaignId}/pacing`)
        .then((value) => {
          if (live) setPacing(value);
        })
        .catch(() => {
          if (live) setPacing(null);
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [campaignId]);

  if (!campaignId || !pacing) return null;

  const pace =
    pacing.messagesPerMinute === null
      ? "—"
      : `${pacing.messagesPerMinute.toLocaleString()} / min`;
  const status =
    pacing.status === "active"
      ? "Observed live"
      : pacing.status === "complete"
        ? "Complete"
        : pacing.status === "estimating"
          ? "Estimating"
          : "Waiting";

  return (
    <Card sx={{ mb: 2, p: { xs: 1.75, sm: 2 } }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        sx={{ gap: 2, alignItems: { xs: "stretch", sm: "center" } }}
      >
        <Stack direction="row" sx={{ gap: 1.25, alignItems: "center", minWidth: 0 }}>
          <SpeedOutlined fontSize="small" />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
              Dispatch pace
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 12 }}>
              {detail(pacing)}
            </Typography>
          </Box>
        </Stack>
        <Stack
          direction="row"
          sx={{
            gap: { xs: 2.5, sm: 3.5 },
            alignItems: "center",
            ml: { sm: "auto" },
            flexWrap: "wrap",
          }}
        >
          <Tooltip title={`Observed from ${pacing.sampleSize} recent transmitted attempt${pacing.sampleSize === 1 ? "" : "s"}.`}>
            <Box>
              <Typography sx={{ fontSize: 12 }} color="text.secondary">
                Current pace
              </Typography>
              <Typography sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {pace}
              </Typography>
            </Box>
          </Tooltip>
          <Tooltip title="Estimate disappears when recent dispatch activity becomes stale.">
            <Box>
              <Typography sx={{ fontSize: 12 }} color="text.secondary">
                Estimated remaining
              </Typography>
              <Stack direction="row" sx={{ gap: 0.5, alignItems: "center" }}>
                <ScheduleOutlined sx={{ fontSize: 16 }} />
                <Typography sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {duration(pacing.estimatedSeconds)}
                </Typography>
              </Stack>
            </Box>
          </Tooltip>
          <Chip size="small" label={status} />
        </Stack>
      </Stack>
    </Card>
  );
}
