"use client";
import { SafetyMetrics, type SafetySummary } from "./sending-safety";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  DialogActions,
  DialogContent,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  IconButton,
  Tooltip,
  Snackbar,
} from "@mui/material";
import {
  Add,
  DownloadOutlined,
  Pause,
  PlayArrow,
  Stop,
  ShieldOutlined,
  GraphicEq,
  Refresh,
  Replay,
  Search,
  PeopleOutlined,
  HubOutlined,
} from "@mui/icons-material";
import { api, date } from "./api-client";
import { appPath } from "@emailsystem/core/paths";
import {
  Failure,
  Loading,
  PageTitle,
  Status,
  EmptyState,
  ResponsiveDialog,
} from "./shared";
type Campaign = {
  id: string;
  name: string;
  state: string;
  recipientCount: number;
  intendedRecipientCount: number;
  createdAt: string;
  scheduledAt: string;
  safeError: string | null;
};
type Summary = Campaign & {
  safety: SafetySummary;
  tracking: {
    enabled: boolean;
    rawVisits: number;
    likelyAutomated: number;
    unclassified: number;
    retentionDays: number;
  };
  counts: Record<string, number>;
  acceptedCount: number;
  providers: { providerId: string; state: string; _count: number }[];
};
type Event = {
  id: string;
  createdAt: string;
  kind: string;
  message: string;
  providerName: string | null;
  maskedEmail: string | null;
};
type Delivery = {
  id: string;
  email: string;
  state: string;
  attemptCount: number;
  safeError: string | null;
};
type Suppression = {
  id: string;
  email: string;
  reason: string;
  createdAt: string;
};
type Page<T> = { items: T[]; nextCursor: string | null };
const states = [
  "PENDING",
  "QUEUED",
  "PROCESSING",
  "PROVIDER_ACCEPTED",
  "DELIVERED",
  "DEFERRED",
  "SOFT_BOUNCED",
  "HARD_BOUNCED",
  "FAILED",
  "COMPLAINED",
  "UNSUBSCRIBED",
  "SUPPRESSED",
  "CANCELLED",
  "UNKNOWN",
];
const label = (v: string) => v.toLowerCase().replaceAll("_", " ");
export function Activity() {
  const params = useSearchParams();
  const campaignPagesLoaded = useRef(false);
  const deliveryPagesLoaded = useRef(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]),
    [next, setNext] = useState<string | null>(null),
    [selected, setSelected] = useState(params.get("campaignId") ?? "");
  const [summary, setSummary] = useState<Summary | null>(null),
    [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [cancel, setCancel] = useState(false),
    [tab, setTab] = useState(0);
  const [events, setEvents] = useState<Event[]>([]),
    [connected, setConnected] = useState(false),
    [eventFilter, setEventFilter] = useState("");
  const [deliveryPage, setDeliveryPage] = useState<Page<Delivery>>({
      items: [],
      nextCursor: null,
    }),
    [filter, setFilter] = useState("");
  const [suppressionOpen, setSuppressionOpen] = useState(false),
    [suppressionEmail, setSuppressionEmail] = useState(""),
    [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const refresh = useCallback(async () => {
    const data = await api<Page<Campaign>>("campaigns");
    setCampaigns((old) => [
      ...data.items,
      ...old.filter((c) => !data.items.some((n) => n.id === c.id)),
    ]);
    if (!campaignPagesLoaded.current) setNext(data.nextCursor);
    if (selected) setSummary(await api<Summary>("campaigns/" + selected));
  }, [selected]);
  useEffect(() => {
    let live = true;
    campaignPagesLoaded.current = false;
    void Promise.all([
      api<Page<Campaign>>("campaigns"),
      api<{ id: string; name: string }[]>("providers"),
      selected ? api<Summary>("campaigns/" + selected) : Promise.resolve(null),
    ])
      .then(([data, providers, detail]) => {
        if (live) {
          setCampaigns(data.items);
          setNext(data.nextCursor);
          setSummary(detail);
          setNames(Object.fromEntries(providers.map((p) => [p.id, p.name])));
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    const interval = setInterval(
      () => void refresh().catch((e) => setError(e.message)),
      5000,
    );
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [refresh, selected]);
  useEffect(() => {
    if (!selected) return;
    const source = new EventSource(
      appPath("/api/activity?campaignId=" + selected),
    );
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as Event;
      setEvents((old) =>
        old.some((v) => v.id === event.id) ? old : [...old, event].slice(-300),
      );
    };
    return () => source.close();
  }, [selected]);
  useEffect(() => {
    deliveryPagesLoaded.current = false;
  }, [selected, filter]);
  useEffect(() => {
    let live = true;
    if (selected && !deliveryPagesLoaded.current)
      void api<Page<Delivery>>(
        `campaigns/${selected}/deliveries?state=${filter}`,
      )
        .then((data) => {
          if (live && !deliveryPagesLoaded.current) setDeliveryPage(data);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [selected, filter, summary]);
  async function action(kind: "pause" | "resume" | "cancel" | "retry") {
    setBusy(true);
    setError("");
    try {
      await api("campaigns/" + selected + "/" + kind, {});
      setCancel(false);
      await refresh();
      setToast(
        kind === "pause"
          ? "Campaign paused."
          : kind === "resume"
            ? "Campaign resumed."
            : kind === "retry"
              ? "Failed recipients requeued."
              : "Remaining sends cancelled.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function inspectSuppression() {
    setError("");
    try {
      setSuppressions(
        await api<Suppression[]>(
          "suppressions?email=" + encodeURIComponent(suppressionEmail),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const done = summary
    ? Object.entries(summary.counts).reduce(
        (n, [state, count]) =>
          n +
          (["PENDING", "QUEUED", "PROCESSING", "DEFERRED"].includes(state)
            ? 0
            : count),
        0,
      )
    : 0;
  const metrics: [string, number][] = summary
    ? [
        ["Delivered", summary.counts.DELIVERED ?? 0],
        ["Provider accepted", summary.acceptedCount],
        ["Failed", summary.counts.FAILED ?? 0],
        [
          "Remaining",
          (summary.counts.PENDING ?? 0) +
            (summary.counts.QUEUED ?? 0) +
            (summary.counts.PROCESSING ?? 0) +
            (summary.counts.DEFERRED ?? 0),
        ],
      ]
    : [];
  const secondary: [string, number][] = summary
    ? [
        ["Recipients", summary.intendedRecipientCount],
        [
          "Queued",
          (summary.counts.PENDING ?? 0) + (summary.counts.QUEUED ?? 0),
        ],
        ["Processing", summary.counts.PROCESSING ?? 0],
        ["Deferred", summary.counts.DEFERRED ?? 0],
        [
          "Bounced",
          (summary.counts.HARD_BOUNCED ?? 0) +
            (summary.counts.SOFT_BOUNCED ?? 0),
        ],
        ["Suppressed", summary.counts.SUPPRESSED ?? 0],
        ["Unknown", summary.counts.UNKNOWN ?? 0],
        ["Cancelled", summary.counts.CANCELLED ?? 0],
        ["Complaints", summary.counts.COMPLAINED ?? 0],
      ]
    : [];
  function selectCampaign(id: string) {
    setSelected(id);
    setSummary(null);
    setEvents([]);
    setConnected(false);
    setDeliveryPage({ items: [], nextCursor: null });
    window.history.replaceState(null, "", "/activity?campaignId=" + id);
  }
  return (
    <>
      <PageTitle
        title="Activity"
        description="Follow your campaigns, from queue to delivery."
        action={
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Tooltip title="Refresh activity">
              <IconButton
                aria-label="Refresh activity"
                onClick={() => void refresh().catch((e) => setError(e.message))}
              >
                <Refresh fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button
              startIcon={<ShieldOutlined />}
              onClick={() => {
                setSuppressionOpen(true);
                void inspectSuppression();
              }}
            >
              Suppressions
            </Button>
          </Stack>
        }
      />
      <Failure error={error} />
      {loading ? (
        <Loading />
      ) : !campaigns.length ? (
        <Card>
          <EmptyState
            icon={<GraphicEq />}
            title="No campaigns yet"
            description="Prepare your first email in Blast."
            action={
              <Button
                variant="contained"
                href={appPath("/blast")}
                startIcon={<Add />}
              >
                Create a campaign
              </Button>
            }
          />
        </Card>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "220px minmax(0,1fr)" },
            gap: 2.5,
          }}
        >
          <Stack spacing={1.25} sx={{ alignSelf: "start", minWidth: 0 }}>
            <TextField
              select
              label="Campaign"
              value={selected}
              onChange={(e) => selectCampaign(e.target.value)}
              slotProps={{
                select: {
                  MenuProps: {
                    slotProps: {
                      paper: {
                        sx: {
                          maxHeight: 320,
                          overscrollBehavior: "contain",
                        },
                      },
                    },
                  },
                },
              }}
              sx={{ display: { xs: "block", lg: "none" } }}
            >
              {campaigns.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: { xs: "none", lg: "block" }, fontWeight: 600 }}
            >
              Campaigns
            </Typography>
            {campaigns.map((c) => (
              <Card
                key={c.id}
                component="button"
                onClick={() => selectCampaign(c.id)}
                aria-pressed={c.id === selected}
                sx={{
                  display: { xs: "none", lg: "block" },
                  p: 1.75,
                  textAlign: "left",
                  cursor: "pointer",
                  borderColor: c.id === selected ? "primary.main" : "divider",
                  bgcolor:
                    c.id === selected ? "action.selected" : "background.paper",
                  transition: "background-color 160ms",
                  "&:hover": { bgcolor: "action.hover" },
                  font: "inherit",
                }}
              >
                <Typography
                  sx={{ fontWeight: 700, mb: 1, overflowWrap: "anywhere" }}
                >
                  {c.name}
                </Typography>
                <Status value={c.state} />
                <Typography
                  color="text.secondary"
                  sx={{ fontSize: 12, mt: 1.5 }}
                >
                  {c.intendedRecipientCount.toLocaleString()} recipients ·{" "}
                  {date(c.createdAt)}
                </Typography>
              </Card>
            ))}
            {next && (
              <Button
                onClick={() =>
                  void api<Page<Campaign>>("campaigns?cursor=" + next)
                    .then((p) => {
                      campaignPagesLoaded.current = true;
                      setCampaigns((old) => [
                        ...old,
                        ...p.items.filter(
                          (c) => !old.some((o) => o.id === c.id),
                        ),
                      ]);
                      setNext(p.nextCursor);
                    })
                    .catch((e) => setError(e.message))
                }
              >
                Load older campaigns
              </Button>
            )}
          </Stack>
          {!selected ? (
            <Card sx={{ alignSelf: "start" }}>
              <EmptyState
                icon={<GraphicEq />}
                title="Choose a campaign"
                description="See its progress and latest events."
              />
            </Card>
          ) : !summary ? (
            <Loading />
          ) : (
            <Stack spacing={2.5} sx={{ minWidth: 0 }}>
              <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack
                  sx={{
                    justifyContent: "space-between",
                    gap: 2,
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                  }}
                  direction="row"
                >
                  <Box sx={{ flex: 1, minWidth: { xs: 210, sm: 0 } }}>
                    <Stack
                      sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}
                      direction="row"
                    >
                      <Typography
                        variant="h6"
                        sx={{ overflowWrap: "anywhere" }}
                      >
                        {summary.name}
                      </Typography>
                      <Status value={summary.state} />
                    </Stack>
                    <Typography
                      color="text.secondary"
                      sx={{ fontSize: 13, mt: 1 }}
                    >
                      Scheduled {date(summary.scheduledAt)}
                    </Typography>
                  </Box>
                  <Stack sx={{ gap: 1, flexWrap: "wrap" }} direction="row">
                    {["QUEUED", "SENDING"].includes(summary.state) && (
                      <Button
                        variant="outlined"
                        aria-label="Pause campaign"
                        startIcon={<Pause />}
                        disabled={busy}
                        onClick={() => void action("pause")}
                      >
                        Pause
                      </Button>
                    )}
                    {summary.state === "PAUSED" &&
                      !summary.safety.pausedReason && (
                        <Button
                          variant="contained"
                          aria-label="Resume campaign"
                          startIcon={<PlayArrow />}
                          disabled={busy}
                          onClick={() => void action("resume")}
                        >
                          Resume
                        </Button>
                      )}
                    {["FAILED", "COMPLETED_WITH_ERRORS"].includes(
                      summary.state,
                    ) &&
                      (summary.counts.FAILED ?? 0) > 0 && (
                        <Button
                          variant="contained"
                          aria-label="Retry failed recipients"
                          startIcon={<Replay />}
                          disabled={busy || !!summary.safety.pausedReason}
                          onClick={() => void action("retry")}
                        >
                          Retry failed
                        </Button>
                      )}
                    {["PREPARING", "QUEUED", "SENDING", "PAUSED"].includes(
                      summary.state,
                    ) && (
                      <Button
                        color="error"
                        aria-label="Cancel campaign"
                        startIcon={<Stop />}
                        onClick={() => setCancel(true)}
                      >
                        Cancel
                      </Button>
                    )}
                    <Tooltip title="Export CSV">
                      <IconButton
                        aria-label="Export CSV"
                        href={appPath(`/api/campaigns/${selected}/export`)}
                      >
                        <DownloadOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
                {summary.safeError &&
                  summary.safeError !== summary.safety.pausedReason && (
                    <Alert severity="warning" sx={{ mt: 2 }}>
                      {summary.safeError}
                    </Alert>
                  )}
                <Box sx={{ mt: 3, mb: 2 }}>
                  <Stack
                    direction="row"

                    sx={{ justifyContent: "space-between", mb: 1 }}
                  >
                    <Typography sx={{ fontSize: 13 }}>
                      Dispatch progress
                    </Typography>
                    <Typography sx={{ fontSize: 13 }}>
                      {done.toLocaleString()} /{" "}
                      {summary.intendedRecipientCount.toLocaleString()}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={
                      summary.intendedRecipientCount
                        ? Math.min(
                            100,
                            (done / summary.intendedRecipientCount) * 100,
                          )
                        : 0
                    }
                    aria-label="Dispatch progress"
                  />
                </Box>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "repeat(2,minmax(0,1fr))",
                      sm: "repeat(4,minmax(0,1fr))",
                    },
                    gap: 2,
                    mt: 2.5,
                  }}
                >
                  {metrics.map(([name, value]) => (
                    <Box key={name}>
                      <Typography
                        sx={{
                          fontSize: 26,
                          fontWeight: 650,
                          letterSpacing: "-.03em",
                          fontVariantNumeric: "tabular-nums",
                          color:
                            name === "Delivered"
                              ? "success.main"
                              : name === "Failed" && value
                                ? "error.main"
                                : "text.primary",
                        }}
                      >
                        {value.toLocaleString()}
                      </Typography>
                      <Tooltip
                        title={
                          name === "Provider accepted"
                            ? "Accepted by the provider. Delivery requires a separate webhook confirmation."
                            : name === "Remaining"
                              ? "Pending, queued, processing and deferred recipients."
                              : name
                        }
                      >
                        <Typography variant="caption" color="text.secondary">
                          {name}
                        </Typography>
                      </Tooltip>
                    </Box>
                  ))}
                </Box>
                <Stack
                  direction="row"
                  sx={{
                    mt: 2.5,
                    pt: 2,
                    borderTop: 1,
                    borderColor: "divider",
                    columnGap: 2,
                    rowGap: 1,
                    flexWrap: "wrap",
                  }}
                >
                  {secondary.map(([name, value]) => (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      key={name}
                    >
                      {name}{" "}
                      <Box
                        component="span"
                        sx={{
                          ml: 0.5,
                          fontWeight: 600,
                          color:
                            name === "Unknown" && value
                              ? "warning.main"
                              : "text.primary",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {value.toLocaleString()}
                      </Box>
                    </Typography>
                  ))}
                </Stack>
                <SafetyMetrics
                  safety={summary.safety}
                  campaignId={summary.id}
                  refresh={() => {
                    void refresh().catch((e) => setError(e.message));
                  }}
                />
                {summary.tracking.enabled && (
                  <Card sx={{ p: 2 }}>
                    <Typography variant="h6" sx={{ mb: 1 }}>
                      Link visits
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={3}
                      sx={{ flexWrap: "wrap", rowGap: 1 }}
                    >
                      {[
                        ["Raw visits", summary.tracking.rawVisits],
                        ["Likely automated", summary.tracking.likelyAutomated],
                        ["Unclassified", summary.tracking.unclassified],
                      ].map(([label, value]) => (
                        <Stack key={String(label)}>
                          <Typography variant="h6">
                            {Number(value).toLocaleString()}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {label}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Last {summary.tracking.retentionDays} days. Automated
                      detection is an estimate; visits do not confirm human
                      engagement.
                    </Typography>
                  </Card>
                )}
              </Card>
              <Card sx={{ overflow: "hidden" }}>
                <Tabs
                  value={tab}
                  onChange={(_, v) => setTab(v)}
                  variant="fullWidth"
                  sx={{
                    "& .MuiTab-root": {
                      whiteSpace: "nowrap",
                      minWidth: 0,
                      px: { xs: 1, sm: 2 },
                    },
                  }}
                >
                  <Tab
                    icon={
                      <GraphicEq
                        sx={{
                          fontSize: 17,
                          display: { xs: "none", sm: "block" },
                        }}
                      />
                    }
                    iconPosition="start"
                    label="Live events"
                  />
                  <Tab
                    icon={
                      <PeopleOutlined
                        sx={{
                          fontSize: 17,
                          display: { xs: "none", sm: "block" },
                        }}
                      />
                    }
                    iconPosition="start"
                    label="Recipients"
                  />
                  <Tab
                    icon={
                      <HubOutlined
                        sx={{
                          fontSize: 17,
                          display: { xs: "none", sm: "block" },
                        }}
                      />
                    }
                    iconPosition="start"
                    label="Providers"
                  />
                </Tabs>
                <Divider />
                {tab === 0 ? (
                  <>
                    <Stack
                      direction="row"

                      sx={{ gap: 2, alignItems: "center", px: 2.5, py: 2 }}
                    >
                      <Status value={connected ? "LIVE" : "RECONNECTING"} />
                      <TextField
                        select
                        label="Event filter"
                        value={eventFilter}
                        onChange={(e) => setEventFilter(e.target.value)}
                        sx={{ maxWidth: 220 }}
                      >
                        <MenuItem value="">All events</MenuItem>
                        {[...new Set(events.map((e) => e.kind))]
                          .sort()
                          .map((kind) => (
                            <MenuItem key={kind} value={kind}>
                              {label(kind)}
                            </MenuItem>
                          ))}
                      </TextField>
                    </Stack>
                    <Box
                      role="log"
                      aria-label="Campaign events"
                      aria-live="polite"
                      sx={{
                        bgcolor: "action.hover",
                        color: "text.primary",
                        p: 2.5,
                        height: 310,
                        overflow: "auto",
                        fontFamily: "ui-monospace, SFMono-Regular, monospace",
                        fontSize: 12,
                      }}
                    >
                      {!events.length ? (
                        <Typography
                          sx={{ fontSize: 13 }}
                          color="text.secondary"
                        >
                          Waiting for campaign events…
                        </Typography>
                      ) : (
                        events
                          .filter((e) => !eventFilter || e.kind === eventFilter)
                          .map((e) => (
                            <Box
                              key={e.id}
                              sx={{
                                py: 1,
                                borderBottom: 1,
                                borderColor: "divider",
                                overflowWrap: "anywhere",
                              }}
                            >
                              <Stack
                                sx={{ gap: 1.5, flexWrap: "wrap" }}
                                direction="row"
                              >
                                <Box
                                  component="time"
                                  sx={{ color: "text.secondary" }}
                                >
                                  {new Date(e.createdAt).toLocaleTimeString()}
                                </Box>
                                <Box sx={{ color: "text.primary" }}>
                                  {e.providerName ?? "EmailSystem"}
                                </Box>
                                <Box>{e.maskedEmail}</Box>
                                <Box
                                  sx={{
                                    color:
                                      e.kind === "DELIVERED"
                                        ? "success.main"
                                        : e.kind === "UNKNOWN"
                                          ? "warning.main"
                                          : "text.secondary",
                                  }}
                                >
                                  {e.kind}
                                </Box>
                              </Stack>
                              <Box sx={{ mt: 0.5, color: "text.secondary" }}>
                                {e.message}
                              </Box>
                            </Box>
                          ))
                      )}
                    </Box>
                  </>
                ) : tab === 1 ? (
                  <Box sx={{ p: 2.5 }}>
                    <TextField
                      select
                      label="Delivery status"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      sx={{ maxWidth: 260, mb: 2 }}
                    >
                      <MenuItem value="">All statuses</MenuItem>
                      {states.map((s) => (
                        <MenuItem key={s} value={s}>
                          {label(s)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button
                      startIcon={<Refresh />}
                      sx={{ ml: { sm: 1 }, mb: 2 }}
                      onClick={() => {
                        deliveryPagesLoaded.current = false;
                        void api<Page<Delivery>>(
                          `campaigns/${selected}/deliveries?state=${filter}`,
                        )
                          .then(setDeliveryPage)
                          .catch((e) => setError(e.message));
                      }}
                    >
                      Refresh recipients
                    </Button>
                    {deliveryPage.items.length === 0 ? (
                      <Typography color="text.secondary">
                        No matching recipients.
                      </Typography>
                    ) : (
                      deliveryPage.items.map((d) => (
                        <Box
                          key={d.id}
                          sx={{
                            py: 1.5,
                            borderBottom: 1,
                            borderColor: "divider",
                          }}
                        >
                          <Stack
                            sx={{ gap: 1, justifyContent: "space-between" }}
                            direction={{ xs: "column", sm: "row" }}
                          >
                            <Typography
                              sx={{ fontSize: 14, overflowWrap: "anywhere" }}
                            >
                              {d.email}
                            </Typography>
                            <Stack
                              sx={{ gap: 1, alignItems: "center" }}
                              direction="row"
                            >
                              <Typography
                                sx={{ fontSize: 12 }}
                                color="text.secondary"
                              >
                                {d.attemptCount} attempts
                              </Typography>
                              <Status value={d.state} />
                            </Stack>
                          </Stack>
                          {d.safeError && (
                            <Typography
                              color="text.secondary"
                              sx={{ fontSize: 12, mt: 0.5 }}
                            >
                              {d.safeError}
                            </Typography>
                          )}
                        </Box>
                      ))
                    )}
                    {deliveryPage.nextCursor && (
                      <Button
                        sx={{ mt: 2 }}
                        onClick={() => {
                          deliveryPagesLoaded.current = true;
                          void api<Page<Delivery>>(
                            `campaigns/${selected}/deliveries?state=${filter}&cursor=${deliveryPage.nextCursor}`,
                          )
                            .then((p) =>
                              setDeliveryPage((old) => ({
                                items: [
                                  ...old.items,
                                  ...p.items.filter(
                                    (item) =>
                                      !old.items.some(
                                        (oldItem) => oldItem.id === item.id,
                                      ),
                                  ),
                                ],
                                nextCursor: p.nextCursor,
                              })),
                            )
                            .catch((e) => setError(e.message));
                        }}
                      >
                        Load more recipients
                      </Button>
                    )}
                  </Box>
                ) : (
                  <Box sx={{ p: 2.5 }}>
                    <Typography
                      color="text.secondary"
                      sx={{ fontSize: 13, mb: 2 }}
                    >
                      Attempt counts include retries. Recipient totals are shown
                      above.
                    </Typography>
                    {!summary.providers.length ? (
                      <Typography color="text.secondary">
                        No sending attempts yet.
                      </Typography>
                    ) : (
                      [
                        ...new Set(summary.providers.map((p) => p.providerId)),
                      ].map((id) => (
                        <Box key={id} sx={{ py: 1.5 }}>
                          <Typography sx={{ fontWeight: 700 }}>
                            {names[id] ?? "Archived provider"}
                          </Typography>
                          <Stack
                            direction="row"

                            sx={{ gap: 1, flexWrap: "wrap", mt: 1 }}
                          >
                            {summary.providers
                              .filter((p) => p.providerId === id)
                              .map((p) => (
                                <Chip
                                  key={p.state}
                                  size="small"
                                  label={`${p._count} ${label(p.state)}`}
                                />
                              ))}
                          </Stack>
                        </Box>
                      ))
                    )}
                  </Box>
                )}
              </Card>
            </Stack>
          )}
        </Box>
      )}
      <ResponsiveDialog
        open={cancel}
        onClose={() => setCancel(false)}
        busy={busy}
        title="Cancel remaining sends?"
      >
        <DialogContent>
          <Failure error={error} />
          Unclaimed recipients will be cancelled. Messages already accepted by a
          provider and attempts already in progress keep their actual outcomes.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancel(false)}>Keep campaign</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy}
            onClick={() => void action("cancel")}
          >
            Confirm cancellation
          </Button>
        </DialogActions>
      </ResponsiveDialog>
      <ResponsiveDialog
        open={suppressionOpen}
        onClose={() => setSuppressionOpen(false)}
        title="Suppressed recipients"
        width={600}
        mobileFullScreen
      >
        <DialogContent>
          <Typography color="text.secondary" sx={{ fontSize: 14, mb: 2 }}>
            Hard bounces, complaints, and unsubscribes are excluded from future
            sends in your account.
          </Typography>
          <Failure error={error} />
          <Stack sx={{ gap: 1 }} direction="row">
            <TextField
              label="Email address or search"
              value={suppressionEmail}
              onChange={(e) => setSuppressionEmail(e.target.value)}
            />
            <Tooltip title="Search">
              <IconButton
                aria-label="Search suppressions"
                onClick={() => void inspectSuppression()}
              >
                <Search fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Button
            startIcon={<ShieldOutlined />}
            sx={{ my: 1 }}
            disabled={!suppressionEmail.includes("@") || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("suppressions", { email: suppressionEmail });
                await inspectSuppression();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Suppress address
          </Button>
          {!suppressions.length ? (
            <Typography color="text.secondary">
              No matching suppressions.
            </Typography>
          ) : (
            suppressions.map((s) => (
              <Box
                key={s.id}
                sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}
              >
                <Typography sx={{ overflowWrap: "anywhere" }}>
                  {s.email}
                </Typography>
                <Typography sx={{ fontSize: 12 }} color="text.secondary">
                  {label(s.reason)} · {date(s.createdAt)}
                </Typography>
              </Box>
            ))
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuppressionOpen(false)}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>
      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast("")}
        message={toast}
      />
    </>
  );
}
