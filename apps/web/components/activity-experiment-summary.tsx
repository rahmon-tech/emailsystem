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
import { DownloadOutlined, ScienceOutlined } from "@mui/icons-material";
import { appPath } from "@emailsystem/core/paths";
import { api } from "./api-client";

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

function usage(used: number, limit: number) {
  return Math.min(100, limit > 0 ? (used / limit) * 100 : 0);
}

export function ActivityExperimentSummary() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [summary, setSummary] = useState<ExperimentSummary | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let live = true;
    setSummary(undefined);
    if (!campaignId) return;
    void api<ExperimentSummary | null>(`campaigns/${campaignId}/experiment`)
      .then((value) => {
        if (live) setSummary(value);
      })
      .catch(() => {
        if (live) setSummary(null);
      });
    return () => {
      live = false;
    };
  }, [campaignId]);

  if (!campaignId || summary === undefined || summary === null) return null;

  return (
    <Card sx={{ mb: 2, p: { xs: 1.75, sm: 2 } }} aria-label="Experiment run">
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
            <Chip size="small" label={summary.state.toLowerCase().replaceAll("_", " ")} />
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
              sx={{ mt: 0.75 }}
            />
          </Box>
        </Box>

        <Typography variant="caption" color="text.secondary">
          {summary.stopReason
            ? summary.stopReason
            : summary.expiresAt
              ? `Run expires ${new Date(summary.expiresAt).toLocaleString()}.`
              : "Run expiry has not been established yet."}
        </Typography>
      </Stack>
    </Card>
  );
}
