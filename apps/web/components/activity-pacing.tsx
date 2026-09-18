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

type Result = { campaignId: string; pacing: Pacing };

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
  if (pacing.campaignState === "PAUSED") return "This campaign is paused.";
  if (pacing.safetyWaitReason) return pacing.safetyWaitReason;
  if (pacing.status === "complete") return "All recipients have finished sending.";
  if (pacing.status === "waiting")
    return pacing.sampleSize
      ? "Sending is temporarily idle. The time estimate will update when sending continues."
      : "Waiting for enough sending activity to calculate speed.";
  if (pacing.status === "estimating")
    return "Calculating sending speed and time remaining.";
  return "Based on recent sends. Speed can change when a provider slows down, reaches a limit, or retries a message.";
}

export function ActivityPacing() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let live = true;
    if (!campaignId) return;
    const refresh = () =>
      void api<Pacing>(`campaigns/${campaignId}/pacing`)
        .then((pacing) => {
          if (live) setResult({ campaignId, pacing });
        })
        .catch(() => {
          if (live) setResult(null);
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [campaignId]);

  if (!campaignId || result?.campaignId !== campaignId) return null;
  const pacing = result.pacing;
  const pace =
    pacing.messagesPerMinute === null
      ? "—"
      : `${pacing.messagesPerMinute.toLocaleString()} / min`;
  const status =
    pacing.status === "active"
      ? "Sending now"
      : pacing.status === "complete"
        ? "Finished"
        : pacing.status === "estimating"
          ? "Calculating"
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
              Sending progress
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
          <Tooltip title={`Based on ${pacing.sampleSize} recent send${pacing.sampleSize === 1 ? "" : "s"}.`}>
            <Box>
              <Typography sx={{ fontSize: 12 }} color="text.secondary">
                Sending speed
              </Typography>
              <Typography sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {pace}
              </Typography>
            </Box>
          </Tooltip>
          <Tooltip title="This estimate updates automatically as sending speed changes.">
            <Box>
              <Typography sx={{ fontSize: 12 }} color="text.secondary">
                Time remaining
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
