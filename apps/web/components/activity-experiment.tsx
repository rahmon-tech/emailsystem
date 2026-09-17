"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { DownloadOutlined, FactCheckOutlined } from "@mui/icons-material";
import { api, date } from "./api-client";
import { appPath } from "@emailsystem/core/paths";

type ExperimentRun = {
  id: string;
  state: string;
  authorizationRef: string;
  maxRecipients: number;
  maxAttempts: number;
  recipientsUsed: number;
  attemptsUsed: number;
  startedAt: string | null;
  expiresAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  profile: { name: string };
};

type Result = { campaignId: string; run: ExperimentRun | null };

function percentage(used: number, limit: number) {
  return limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
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
      void api<ExperimentRun | null>(`campaigns/${campaignId}/experiment`)
        .then((run) => {
          if (live) setResult({ campaignId, run });
        })
        .catch(() => {
          if (live) setResult({ campaignId, run: null });
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [campaignId]);

  if (!campaignId || result?.campaignId !== campaignId || !result.run) return null;
  const run = result.run;

  return (
    <Card
      aria-label="Authorized experiment run"
      sx={{ mb: 2, p: { xs: 1.75, sm: 2 } }}
    >
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ gap: 1.5, alignItems: { xs: "flex-start", sm: "center" } }}
        >
          <Stack direction="row" sx={{ gap: 1, alignItems: "center", minWidth: 0 }}>
            <FactCheckOutlined fontSize="small" />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700 }}>Authorized experiment</Typography>
              <Typography variant="caption" color="text.secondary">
                {run.profile.name} · authorization {run.authorizationRef}
              </Typography>
            </Box>
          </Stack>
          <Stack
            direction="row"
            sx={{ gap: 1, alignItems: "center", ml: { sm: "auto" }, flexWrap: "wrap" }}
          >
            <Chip size="small" label={run.state.toLowerCase().replaceAll("_", " ")} />
            <Button
              size="small"
              startIcon={<DownloadOutlined />}
              href={appPath(`/api/experiment-runs/${run.id}/evidence`)}
            >
              Evidence export
            </Button>
          </Stack>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
          }}
        >
          <Box>
            <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1, mb: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                Controlled recipients used
              </Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {run.recipientsUsed.toLocaleString()} / {run.maxRecipients.toLocaleString()}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={percentage(run.recipientsUsed, run.maxRecipients)}
              aria-label="Experiment recipient usage"
            />
          </Box>
          <Box>
            <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1, mb: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                Transport attempts used
              </Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {run.attemptsUsed.toLocaleString()} / {run.maxAttempts.toLocaleString()}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={percentage(run.attemptsUsed, run.maxAttempts)}
              aria-label="Experiment attempt usage"
            />
          </Box>
        </Box>

        <Typography variant="caption" color="text.secondary">
          {run.stoppedAt
            ? `Stopped ${date(run.stoppedAt)}.`
            : run.expiresAt
              ? `Bounded run expires ${date(run.expiresAt)}.`
              : run.startedAt
                ? `Started ${date(run.startedAt)}.`
                : "Run is ready but has not started."}
        </Typography>

        {run.stopReason && <Alert severity="info">{run.stopReason}</Alert>}
      </Stack>
    </Card>
  );
}
