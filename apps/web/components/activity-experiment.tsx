"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Box,
  Button,
  Card,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import {
  DownloadOutlined,
  ScienceOutlined,
  TimerOutlined,
} from "@mui/icons-material";
import { appPath } from "@emailsystem/core/paths";
import { api } from "./api-client";

type ExperimentRun = {
  id: string;
  profileVersion: number;
  authorizationRef: string;
  state: string;
  maxRecipients: number;
  maxAttempts: number;
  maxDurationSeconds: number;
  recipientsUsed: number;
  attemptsUsed: number;
  startsAt: string | null;
  expiresAt: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  killSwitchAt: string | null;
  stopReason: string | null;
  profile: { name: string };
};

type Result = {
  campaignId: string;
  experiment: ExperimentRun | null;
};

function percent(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function ActivityExperiment() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let live = true;
    if (!campaignId) {
      setResult(null);
      return;
    }
    const refresh = () =>
      void api<{ experiment: ExperimentRun | null }>(
        `campaigns/${campaignId}/experiment`,
      )
        .then(({ experiment }) => {
          if (live) setResult({ campaignId, experiment });
        })
        .catch(() => {
          if (live) setResult({ campaignId, experiment: null });
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [campaignId]);

  if (!campaignId || result?.campaignId !== campaignId || !result.experiment)
    return null;

  const run = result.experiment;

  return (
    <Card
      aria-label="Experiment run"
      sx={{ mb: 2, p: { xs: 1.75, sm: 2 } }}
    >
      <Stack spacing={1.75}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ gap: 1.25, alignItems: { xs: "stretch", sm: "center" } }}
        >
          <Stack direction="row" sx={{ gap: 1, alignItems: "center", minWidth: 0 }}>
            <ScienceOutlined fontSize="small" />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                Authorized experiment
              </Typography>
              <Typography
                color="text.secondary"
                sx={{ fontSize: 12, overflowWrap: "anywhere" }}
              >
                {run.profile.name} · v{run.profileVersion} · {run.authorizationRef}
              </Typography>
            </Box>
          </Stack>
          <Stack
            direction="row"
            sx={{ gap: 1, alignItems: "center", ml: { sm: "auto" }, flexWrap: "wrap" }}
          >
            <Chip size="small" label={run.state.toLowerCase().replaceAll("_", " ")} />
            <Button
              component="a"
              href={appPath(`/api/experiment-runs/${run.id}/evidence`)}
              size="small"
              startIcon={<DownloadOutlined />}
            >
              Export evidence
            </Button>
          </Stack>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 1.5,
          }}
        >
          <Box>
            <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Controlled recipients
              </Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {run.recipientsUsed.toLocaleString()} / {run.maxRecipients.toLocaleString()}
              </Typography>
            </Stack>
            <LinearProgress
              aria-label="Experiment recipient usage"
              variant="determinate"
              value={percent(run.recipientsUsed, run.maxRecipients)}
              sx={{ mt: 0.75 }}
            />
          </Box>
          <Box>
            <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Transport attempts
              </Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {run.attemptsUsed.toLocaleString()} / {run.maxAttempts.toLocaleString()}
              </Typography>
            </Stack>
            <LinearProgress
              aria-label="Experiment attempt usage"
              variant="determinate"
              value={percent(run.attemptsUsed, run.maxAttempts)}
              sx={{ mt: 0.75 }}
            />
          </Box>
        </Box>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ gap: { xs: 0.5, sm: 2 }, color: "text.secondary" }}
        >
          <Stack direction="row" sx={{ gap: 0.5, alignItems: "center" }}>
            <TimerOutlined sx={{ fontSize: 16 }} />
            <Typography variant="caption">
              Approved duration {duration(run.maxDurationSeconds)}
            </Typography>
          </Stack>
          {run.expiresAt && (
            <Typography variant="caption">
              Expires {new Date(run.expiresAt).toLocaleString()}
            </Typography>
          )}
        </Stack>

        {run.stopReason && (
          <Typography variant="caption" color="text.secondary">
            Stop reason: {run.stopReason}
          </Typography>
        )}
      </Stack>
    </Card>
  );
}
