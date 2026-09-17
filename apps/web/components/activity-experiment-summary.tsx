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
import { DownloadOutlined, ScienceOutlined } from "@mui/icons-material";
import { appPath } from "@emailsystem/core/paths";
import { api, date } from "./api-client";

type ExperimentSummary = {
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

type Result = {
  campaignId: string;
  summary: ExperimentSummary | null;
};

function usage(used: number, limit: number) {
  return Math.min(100, limit > 0 ? (used / limit) * 100 : 0);
}

export function ActivityExperimentSummary() {
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
      void api<ExperimentSummary | null>(`campaigns/${campaignId}/experiment`)
        .then((summary) => {
          if (live) setResult({ campaignId, summary });
        })
        .catch(() => {
          if (live) setResult({ campaignId, summary: null });
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [campaignId]);

  if (
    !campaignId ||
    result?.campaignId !== campaignId ||
    result.summary === null
  )
    return null;

  const summary = result.summary;

  return (
    <Card
      sx={{ mb: 2, p: { xs: 1.75, sm: 2 } }}
      aria-label="Authorized experiment run"
    >
      <Stack spacing={1.75}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{ gap: 1.5, alignItems: { xs: "stretch", sm: "center" } }}
        >
          <Stack direction="row" sx={{ gap: 1, alignItems: "center", minWidth: 0 }}>
            <ScienceOutlined fontSize="small" />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700 }}>Authorized experiment</Typography>
              <Typography variant="caption" color="text.secondary">
                {summary.profile.name} · authorization {summary.authorizationRef}
              </Typography>
            </Box>
          </Stack>
          <Stack
            direction="row"
            sx={{ gap: 1, ml: { sm: "auto" }, alignItems: "center", flexWrap: "wrap" }}
          >
            <Chip
              size="small"
              label={summary.state.toLowerCase().replaceAll("_", " ")}
            />
            <Button
              component="a"
              href={appPath(`/api/experiment-runs/${summary.id}/evidence`)}
              startIcon={<DownloadOutlined />}
              size="small"
            >
              Export evidence
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
            <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
              <Typography variant="caption">Controlled recipients</Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {summary.recipientsUsed.toLocaleString()} / {summary.maxRecipients.toLocaleString()}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={usage(summary.recipientsUsed, summary.maxRecipients)}
              aria-label="Experiment recipient usage"
              sx={{ mt: 0.75 }}
            />
          </Box>
          <Box>
            <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
              <Typography variant="caption">Transport attempts</Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {summary.attemptsUsed.toLocaleString()} / {summary.maxAttempts.toLocaleString()}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={usage(summary.attemptsUsed, summary.maxAttempts)}
              aria-label="Experiment attempt usage"
              sx={{ mt: 0.75 }}
            />
          </Box>
        </Box>

        <Typography variant="caption" color="text.secondary">
          {summary.stoppedAt
            ? `Stopped ${date(summary.stoppedAt)}.`
            : summary.expiresAt
              ? `Bounded run expires ${date(summary.expiresAt)}.`
              : summary.startedAt
                ? `Started ${date(summary.startedAt)}.`
                : "Run is ready but has not started."}
        </Typography>

        {summary.stopReason && <Alert severity="info">{summary.stopReason}</Alert>}
      </Stack>
    </Card>
  );
}
