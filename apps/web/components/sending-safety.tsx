"use client";
import { useEffect, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { ExpandMore, ShieldOutlined } from "@mui/icons-material";
import { api } from "./api-client";
import { Failure, Loading, ResponsiveDialog } from "./shared";
import {
  safetySettings,
  type SafetySettings,
} from "@emailsystem/core/safety-config";
type Settings = SafetySettings & {
  pausedReason: string | null;
  providers: { id: string; name: string; dailyBudgetOverride: number | null }[];
};
export type SafetySummary = {
  usage: {
    scope: string;
    used: number;
    limit: number | null;
    nextReleaseAt: number | null;
  }[];
  domain: string;
  pausedReason: string | null;
  waitReason: string | null;
  nextReleaseAt: number | null;
  reviewScope: "account" | "campaign";
};
export function SafetyReview({
  open,
  close,
  campaignId,
  done,
}: {
  open: boolean;
  close: () => void;
  campaignId?: string;
  done: () => void;
}) {
  const [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <ResponsiveDialog
      open={open}
      onClose={close}
      busy={busy}
      title="Review safety pause"
    >
      <DialogContent>
        <Stack spacing={2}>
          <Failure error={error} />
          <Typography>
            Check the provider reports and correct the cause before allowing
            more sending. Campaigns stay paused after this review.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
            }
            label="I reviewed the outcomes and corrected the cause."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>
          Close
        </Button>
        <Button
          variant="contained"
          disabled={!ack || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("safety/review", {
                acknowledgement: true,
                ...(campaignId ? { campaignId } : {}),
              });
              setAck(false);
              done();
              close();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Record review
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
export function SendingSafety() {
  const [open, setOpen] = useState(false),
    [value, setValue] = useState<Settings | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [review, setReview] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api<Settings>("safety")
      .then((v) => {
        if (live) setValue(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [open]);
  const field = (
    key:
      | "accountDaily"
      | "domainDaily"
      | "providerDaily"
      | "campaignDaily"
      | "complaintRate"
      | "hardBounceRate"
      | "minimumSample",
    label: string,
  ) => (
    <TextField
      key={key}
      label={label}
      type="number"
      fullWidth
      value={value?.[key] ?? ""}
      onChange={(e) =>
        setValue((v) => v && { ...v, [key]: Number(e.target.value) })
      }
      slotProps={{
        htmlInput: {
          min: key.endsWith("Rate") ? 0.01 : 1,
          max: key.endsWith("Rate")
            ? 10
            : key === "minimumSample"
              ? 100000
              : 10000000,
          step: key.endsWith("Rate") ? 0.01 : 1,
        },
      }}
    />
  );
  const pacingField = (
    key: "accountPerMinute" | "domainPerMinute" | "campaignPerMinute",
    label: string,
  ) => (
    <TextField
      key={key}
      label={label}
      type="number"
      fullWidth
      value={value?.[key] ?? ""}
      onChange={(e) =>
        setValue(
          (v) =>
            v && {
              ...v,
              [key]: e.target.value === "" ? null : Number(e.target.value),
            },
        )
      }
      slotProps={{ htmlInput: { min: 1, max: 1000000, step: 1 } }}
      helperText="Blank means no additional ceiling at this scope."
    />
  );
  return (
    <>
      <Button
        startIcon={<ShieldOutlined />}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        Sending safety
      </Button>
      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        title="Sending safety"
        width={640}
        mobileFullScreen
      >
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Failure error={error} />
            {!value ? (
              <Loading />
            ) : (
              <>
                <Typography color="text.secondary" variant="body2">
                  Rolling 24 hours. Each To, CC and BCC address uses one unit.
                </Typography>
                {value.pausedReason && (
                  <Alert
                    severity="warning"
                    action={
                      <Button color="inherit" onClick={() => setReview(true)}>
                        Review
                      </Button>
                    }
                  >
                    {value.pausedReason}
                  </Alert>
                )}
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                    gap: 2.5,
                  }}
                >
                  {field("accountDaily", "Account daily budget")}
                  {field("domainDaily", "Sender-domain daily budget")}
                  {field("providerDaily", "Default provider daily budget")}
                  {value.campaignDaily !== null &&
                    field("campaignDaily", "Default campaign daily budget")}
                </Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={value.campaignDaily !== null}
                      onChange={(_, checked) =>
                        setValue({
                          ...value,
                          campaignDaily: checked ? 5000 : null,
                        })
                      }
                    />
                  }
                  label="Daily budget for new campaigns"
                />
                <Typography variant="caption" color="text.secondary">
                  Larger campaigns queue across days. Adding providers never
                  raises your account or domain budget.
                </Typography>
                <TextField
                  select
                  label="Sender-domain warm-up"
                  value={value.warmupProfile}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      warmupProfile: e.target
                        .value as SafetySettings["warmupProfile"],
                    })
                  }
                  helperText="Controls how cautiously a high-rate sender domain ramps after inactivity. It never raises configured provider limits."
                >
                  <MenuItem value="conservative">Conservative</MenuItem>
                  <MenuItem value="balanced">Balanced</MenuItem>
                  <MenuItem value="high_capacity">
                    High capacity · within configured limits
                  </MenuItem>
                </TextField>
                <Accordion disableGutters>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    Throughput ceilings
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2.5}>
                      {pacingField("accountPerMinute", "Account / minute")}
                      {pacingField("domainPerMinute", "Sender-domain / minute")}
                      {pacingField("campaignPerMinute", "Campaign / minute")}
                      <Typography variant="caption" color="text.secondary">
                        These optional ceilings are shared across providers. The
                        dispatcher always uses the strictest applicable account,
                        sender-domain, campaign, and provider limit.
                      </Typography>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
                <Accordion disableGutters>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    Automatic safety pauses
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2.5}>
                      {field("complaintRate", "Complaint threshold (%)")}
                      {field("hardBounceRate", "Hard bounce threshold (%)")}
                      {field(
                        "minimumSample",
                        "Minimum accepted recipient sample",
                      )}
                      <TextField
                        select
                        label="Pause scope"
                        value={value.brakeScope}
                        onChange={(e) =>
                          setValue({
                            ...value,
                            brakeScope: e.target
                              .value as SafetySettings["brakeScope"],
                          })
                        }
                      >
                        <MenuItem value="both">Account and campaign</MenuItem>
                        <MenuItem value="account">Account</MenuItem>
                        <MenuItem value="campaign">Campaign</MenuItem>
                      </TextField>
                      <Typography variant="caption" color="text.secondary">
                        Uses confirmed provider outcomes over seven days. Safety
                        pauses require administrator review.
                      </Typography>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
                {!!value.providers.length && (
                  <Accordion disableGutters>
                    <AccordionSummary expandIcon={<ExpandMore />}>
                      Provider overrides
                    </AccordionSummary>
                    <AccordionDetails>
                      <Stack spacing={2.5}>
                        {value.providers.map((p, i) => (
                          <TextField
                            key={p.id}
                            label={p.name + " daily budget"}
                            type="number"
                            value={p.dailyBudgetOverride ?? ""}
                            helperText="Blank uses the default provider budget"
                            onChange={(e) =>
                              setValue({
                                ...value,
                                providers: value.providers.map((row, j) =>
                                  j === i
                                    ? {
                                        ...row,
                                        dailyBudgetOverride:
                                          e.target.value === ""
                                            ? null
                                            : Number(e.target.value),
                                      }
                                    : row,
                                ),
                              })
                            }
                          />
                        ))}
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button
            variant="contained"
            disabled={busy || !value}
            onClick={async () => {
              if (!value) return;
              setBusy(true);
              setError("");
              try {
                const { providers } = value;
                const settings = Object.fromEntries(
                  Object.entries(value).filter(
                    ([key]) => key !== "providers" && key !== "pausedReason",
                  ),
                );
                const valid = safetySettings.parse(settings);
                setValue(
                  await api<Settings>(
                    "safety",
                    {
                      ...valid,
                      providers: providers.map(
                        ({ id, dailyBudgetOverride }) => ({
                          id,
                          dailyBudgetOverride,
                        }),
                      ),
                    },
                    "PUT",
                  ),
                );
                setOpen(false);
                setSaved(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save safety settings"}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
      <SafetyReview
        open={review}
        close={() => setReview(false)}
        done={() => {
          void api<Settings>("safety")
            .then(setValue)
            .catch((e) => setError(e.message));
        }}
      />
      <Snackbar
        open={saved}
        autoHideDuration={4000}
        onClose={() => setSaved(false)}
        message="Sending safety updated."
      />
    </>
  );
}
export function SafetyMetrics({
  safety,
  campaignId,
  refresh,
}: {
  safety: SafetySummary;
  campaignId: string;
  refresh: () => void;
}) {
  const [review, setReview] = useState(false);
  const metrics = safety.usage.filter(
    (b) => b.scope === "account" || b.scope.startsWith("domain:"),
  );
  const next =
    safety.nextReleaseAt ??
    metrics
      .map((b) => b.nextReleaseAt)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b)[0];
  return (
    <Stack
      spacing={1.5}
      sx={{ mt: 2, p: 2, bgcolor: "action.hover", borderRadius: 2 }}
      aria-label="Sending safety usage"
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: 2.5,
        }}
      >
        {metrics.map((b) => (
          <Tooltip
            key={b.scope}
            title={
              b.scope === "account"
                ? "Shared across all your campaigns and providers. Includes attempts with an unknown outcome."
                : `Shared by all your senders on ${safety.domain}.`
            }
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack
                direction="row"
                sx={{ justifyContent: "space-between", gap: 1, mb: 1 }}
              >
                <Typography variant="caption">
                  {b.scope === "account" ? "Account · 24h" : "Domain · 24h"}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {b.used.toLocaleString()} / {b.limit?.toLocaleString()}
                </Typography>
              </Stack>
              <LinearProgress
                aria-label={
                  b.scope === "account"
                    ? "Account safety usage"
                    : "Domain safety usage"
                }
                variant="determinate"
                value={Math.min(100, (b.used / (b.limit ?? 1)) * 100)}
                color={b.used >= (b.limit ?? Infinity) ? "warning" : "primary"}
              />
            </Box>
          </Tooltip>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        Provider rate limits also apply.
        {next
          ? ` Capacity releases from ${new Date(next).toLocaleString()}.`
          : ""}
      </Typography>
      {(safety.pausedReason || safety.waitReason) && (
        <Alert severity={safety.pausedReason ? "warning" : "info"}>
          {safety.pausedReason ?? safety.waitReason}
          {safety.pausedReason && (
            <Box sx={{ mt: 1 }}>
              <Button
                size="small"
                startIcon={<ShieldOutlined />}
                onClick={() => setReview(true)}
              >
                Review safety pause
              </Button>
            </Box>
          )}
        </Alert>
      )}
      <SafetyReview
        open={review}
        close={() => setReview(false)}
        campaignId={safety.reviewScope === "campaign" ? campaignId : undefined}
        done={refresh}
      />
    </Stack>
  );
}
