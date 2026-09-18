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
  monthlyUsage: {
    scope: string;
    used: number;
    limit: number | null;
    nextReleaseAt: number | null;
  }[];
  domain: string;
  domains?: string[];
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
      title="Review sending pause"
    >
      <DialogContent>
        <Stack spacing={2}>
          <Failure error={error} />
          <Typography>
            Review recent bounce and complaint results, then fix the cause before
            sending more. Campaigns remain paused until you resume them.
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
    [review, setReview] = useState(false),
    [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api<Settings>("safety")
      .then((v) => {
        if (!live) return;
        setValue(v);
        setNumberDrafts({
          complaintRate: String(v.complaintRate),
          hardBounceRate: String(v.hardBounceRate),
          minimumSample: String(v.minimumSample),
        });
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
      | "accountMonthly"
      | "domainMonthly"
      | "providerDaily"
      | "campaignDaily"
      | "complaintRate"
      | "hardBounceRate"
      | "minimumSample",
    label: string,
  ) => {
    const nullableBudget = [
      "accountDaily",
      "domainDaily",
      "accountMonthly",
      "domainMonthly",
      "providerDaily",
      "campaignDaily",
    ].includes(key);
    return (
    <TextField
      key={key}
      label={label}
      type="number"
      fullWidth
      value={
        nullableBudget
          ? (value?.[key] ?? "")
          : (numberDrafts[key] ?? String(value?.[key] ?? ""))
      }
      onChange={(e) => {
        const raw = e.target.value;
        if (!nullableBudget)
          setNumberDrafts((drafts) => ({ ...drafts, [key]: raw }));
        setValue(
          (v) =>
            v && {
              ...v,
              [key]:
                nullableBudget && raw === ""
                  ? null
                  : raw === ""
                    ? v[key]
                    : Number(raw),
            },
        );
      }}
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
      helperText={
        nullableBudget
          ? "Leave blank if you do not want an extra limit here."
          : undefined
      }
    />
    );
  };
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
      helperText="Leave blank if you do not want an extra speed limit here."
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
        Sending limits & protection
      </Button>
      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        title="Sending limits & protection"
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
                  Set optional limits that apply across all sending services.
                  Each To, CC and BCC recipient counts as one email.
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
                  {field("accountDaily", "All sending · 24 hours")}
                  {field("domainDaily", "Each domain · 24 hours")}
                  {field("accountMonthly", "All sending · monthly")}
                  {field("domainMonthly", "Each domain · monthly")}
                  {value.campaignDaily !== null &&
                    field("campaignDaily", "New campaigns · 24 hours")}
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
                  label="Set a default 24-hour limit for new campaigns"
                />
                <Typography variant="caption" color="text.secondary">
                  Each sending service keeps its own limits. These account and
                  domain limits can only make sending more restrictive, never less.
                </Typography>
                <TextField
                  select
                  label="Domain sending ramp-up"
                  value={value.warmupProfile}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      warmupProfile: e.target
                        .value as SafetySettings["warmupProfile"],
                    })
                  }
                  helperText="Controls how quickly a new or inactive domain increases its sending speed. It never exceeds your service limits."
                >
                  <MenuItem value="conservative">Slow and cautious</MenuItem>
                  <MenuItem value="balanced">Recommended</MenuItem>
                  <MenuItem value="high_capacity">
                    Faster · still within your limits
                  </MenuItem>
                </TextField>
                <Accordion disableGutters>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    Sending speed limits
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2.5}>
                      {pacingField("accountPerMinute", "All sending / minute")}
                      {pacingField("domainPerMinute", "Each domain / minute")}
                      {pacingField("campaignPerMinute", "Each campaign / minute")}
                      <Typography variant="caption" color="text.secondary">
                        EmailSystem always follows the lowest limit that applies
                        to the account, domain, campaign, or sending service.
                      </Typography>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
                <Accordion disableGutters>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    Automatic protection pauses
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2.5}>
                      {field("complaintRate", "Pause when complaints reach (%)")}
                      {field("hardBounceRate", "Pause when hard bounces reach (%)")}
                      {field(
                        "minimumSample",
                        "Minimum recipients before checking",
                      )}
                      <TextField
                        select
                        label="What should pause?"
                        value={value.brakeScope}
                        onChange={(e) =>
                          setValue({
                            ...value,
                            brakeScope: e.target
                              .value as SafetySettings["brakeScope"],
                          })
                        }
                      >
                        <MenuItem value="both">This campaign and all sending</MenuItem>
                        <MenuItem value="account">All sending</MenuItem>
                        <MenuItem value="campaign">Only this campaign</MenuItem>
                      </TextField>
                      <Typography variant="caption" color="text.secondary">
                        Uses confirmed delivery results from the last seven days.
                        A paused campaign stays stopped until an administrator reviews it.
                      </Typography>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
                <Typography variant="caption" color="text.secondary">
                  Your email service limits still apply. These optional account
                  and domain limits can only reduce how much EmailSystem sends.
                </Typography>
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
                for (const [key, label] of [
                  ["complaintRate", "Complaint pause threshold"],
                  ["hardBounceRate", "Hard-bounce pause threshold"],
                  ["minimumSample", "Minimum recipients before checking"],
                ] as const) {
                  const raw = numberDrafts[key]?.trim() ?? "";
                  if (!raw)
                    throw new Error(`${label} is required.`);
                  settings[key] = Number(raw);
                }
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
            {busy ? "Saving…" : "Save limits"}
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
        message="Sending limits updated."
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
  const dailyMetrics = safety.usage.filter(
    (b) => b.scope === "account" || b.scope.startsWith("domain:"),
  );
  const monthlyMetrics = (safety.monthlyUsage ?? []).filter(
    (b) => b.scope === "account-month" || b.scope.startsWith("domain-month:"),
  );
  const metrics = [
    ...dailyMetrics.map((budget) => ({ ...budget, period: "24h" as const })),
    ...monthlyMetrics.map((budget) => ({
      ...budget,
      period: "month" as const,
    })),
  ];
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
      aria-label="Sending limit usage"
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
              b.scope.startsWith("account")
                ? "Shared across all campaigns and sending services. Includes emails already sent or reserved to send, plus test emails."
                : "Shared by every From address using this sending domain."
            }
          >
            <Box sx={{ minWidth: 0 }}>
              <Stack
                direction="row"
                sx={{ justifyContent: "space-between", gap: 1, mb: 1 }}
              >
                <Typography variant="caption">
                  {b.scope.startsWith("account")
                    ? `Account · ${b.period === "month" ? "UTC month" : "24h"}`
                    : `${b.scope
                        .replace("domain-month:", "")
                        .replace("domain:", "")} · ${b.period === "month" ? "UTC month" : "24h"}`}
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
        Your sending services may have additional daily, monthly, or speed limits.
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
                Review pause
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
