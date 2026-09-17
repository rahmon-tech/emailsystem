"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { DownloadOutlined, ScienceOutlined, StopCircleOutlined } from "@mui/icons-material";
import { appPath } from "@emailsystem/core/paths";
import { api } from "./api-client";
import {
  experimentConfigurationLabels,
  type ActivityExperimentVariables,
} from "./activity-experiment-model";

type ExperimentSummary = {
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
  profile: { name: string; variables: ActivityExperimentVariables };
};

type ExperimentMutationResult = Omit<ExperimentSummary, "profile"> & {
  profile: { name: string };
};

type Result = {
  campaignId: string;
  experiment: ExperimentSummary | null;
};

const percent = (used: number, limit: number) =>
  Math.min(100, Math.max(0, limit > 0 ? (used / limit) * 100 : 0));

const stateLabel = (state: string) =>
  state.toLowerCase().replaceAll("_", " ");

export function ActivityExperiment() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [result, setResult] = useState<Result | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopReason, setStopReason] = useState("");
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!campaignId) return;
    const refresh = () =>
      void api<{ experiment: ExperimentSummary | null }>(
        `campaigns/${campaignId}/experiment`,
      )
        .then(({ experiment }) => {
          if (live) setResult({ campaignId, experiment });
        })
        .catch(() => {
          if (!live) return;
          setResult((current) =>
            current?.campaignId === campaignId
              ? current
              : { campaignId, experiment: null },
          );
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

  const experiment = result.experiment;
  const canStop = experiment.state === "READY" || experiment.state === "RUNNING";
  const configuration = experimentConfigurationLabels(experiment.profile.variables);

  const stopExperiment = async () => {
    setStopping(true);
    setStopError(null);
    try {
      const stopped = await api<ExperimentMutationResult>(
        `experiment-runs/${experiment.id}`,
        {
          action: "stop",
          ...(stopReason.trim() ? { reason: stopReason.trim() } : {}),
        },
      );
      setResult({
        campaignId,
        experiment: {
          ...experiment,
          ...stopped,
          profile: experiment.profile,
        },
      });
      setStopOpen(false);
      setStopReason("");
    } catch (error) {
      setStopError(error instanceof Error ? error.message : "Unable to stop experiment.");
    } finally {
      setStopping(false);
    }
  };

  return (
    <Card
      component="section"
      aria-label="Authorized experiment"
      sx={{ mb: 2, p: { xs: 1.75, sm: 2 } }}
    >
      <Stack spacing={1.75}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{
            gap: 1.25,
            alignItems: { xs: "flex-start", sm: "center" },
          }}
        >
          <Stack
            direction="row"
            sx={{ gap: 1, alignItems: "center", minWidth: 0 }}
          >
            <ScienceOutlined fontSize="small" />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700 }}>
                Authorized experiment
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {experiment.profile.name} · profile v{experiment.profileVersion}
              </Typography>
            </Box>
          </Stack>
          <Stack
            direction="row"
            sx={{
              ml: { sm: "auto" },
              gap: 1,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Chip size="small" label={stateLabel(experiment.state)} />
            {canStop && (
              <Button
                size="small"
                color="warning"
                variant="outlined"
                startIcon={<StopCircleOutlined />}
                onClick={() => {
                  setStopError(null);
                  setStopOpen(true);
                }}
              >
                Stop experiment
              </Button>
            )}
            <Button
              component="a"
              size="small"
              startIcon={<DownloadOutlined />}
              href={appPath(`/api/experiment-runs/${experiment.id}/evidence`)}
            >
              Export evidence
            </Button>
          </Stack>
        </Stack>

        <Typography variant="body2" color="text.secondary">
          Authorization reference: {experiment.authorizationRef}
        </Typography>

        <Box>
          <Typography variant="caption" color="text.secondary">
            Approved configuration
          </Typography>
          <Stack
            direction="row"
            sx={{ mt: 0.75, gap: 0.75, flexWrap: "wrap" }}
          >
            {configuration.map((label) => (
              <Chip key={label} size="small" variant="outlined" label={label} />
            ))}
          </Stack>
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 2,
          }}
        >
          <Box>
            <Stack
              direction="row"
              sx={{ justifyContent: "space-between", gap: 1, mb: 0.75 }}
            >
              <Typography variant="caption">Controlled recipients</Typography>
              <Typography
                variant="caption"
                sx={{ fontVariantNumeric: "tabular-nums" }}
              >
                {experiment.recipientsUsed.toLocaleString()} /{" "}
                {experiment.maxRecipients.toLocaleString()}
              </Typography>
            </Stack>
            <LinearProgress
              aria-label="Experiment recipient usage"
              variant="determinate"
              value={percent(
                experiment.recipientsUsed,
                experiment.maxRecipients,
              )}
            />
          </Box>
          <Box>
            <Stack
              direction="row"
              sx={{ justifyContent: "space-between", gap: 1, mb: 0.75 }}
            >
              <Typography variant="caption">Transport attempts</Typography>
              <Typography
                variant="caption"
                sx={{ fontVariantNumeric: "tabular-nums" }}
              >
                {experiment.attemptsUsed.toLocaleString()} /{" "}
                {experiment.maxAttempts.toLocaleString()}
              </Typography>
            </Stack>
            <LinearProgress
              aria-label="Experiment attempt usage"
              variant="determinate"
              value={percent(experiment.attemptsUsed, experiment.maxAttempts)}
            />
          </Box>
        </Box>

        <Typography variant="caption" color="text.secondary">
          {experiment.expiresAt
            ? `Bounded until ${new Date(experiment.expiresAt).toLocaleString()} · maximum duration ${Math.ceil(experiment.maxDurationSeconds / 60).toLocaleString()} min.`
            : `Maximum duration ${Math.ceil(experiment.maxDurationSeconds / 60).toLocaleString()} min; bounded expiry is set when the run starts.`}
        </Typography>

        {experiment.stopReason && (
          <Alert severity={experiment.killSwitchAt ? "warning" : "info"}>
            {experiment.stopReason}
          </Alert>
        )}
      </Stack>

      <Dialog
        open={stopOpen}
        onClose={() => !stopping && setStopOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Stop authorized experiment?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              This stops new experiment transport starts for this run. Existing production safety and provider controls remain unchanged.
            </Typography>
            <TextField
              label="Stop reason"
              value={stopReason}
              onChange={(event) => setStopReason(event.target.value.slice(0, 300))}
              placeholder="Stopped after the approved observation window."
              multiline
              minRows={2}
              inputProps={{ maxLength: 300 }}
              helperText={`${stopReason.length}/300 · optional; stored on the run for review`}
              disabled={stopping}
              autoFocus
            />
            {stopError && <Alert severity="error">{stopError}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStopOpen(false)} disabled={stopping}>
            Keep running
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => void stopExperiment()}
            disabled={stopping}
          >
            {stopping ? "Stopping…" : "Confirm stop"}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
