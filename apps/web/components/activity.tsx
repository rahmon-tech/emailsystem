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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import {
  Add,
  DownloadOutlined,
  Pause,
  PlayArrow,
  Stop,
  ShieldOutlined,
  GraphicEq,
} from "@mui/icons-material";
import { api, date } from "./api-client";
import { Failure, Loading, PageTitle, Status } from "./shared";
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
    const source = new EventSource("/api/activity?campaignId=" + selected);
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
  async function action(kind: "pause" | "resume" | "cancel") {
    setBusy(true);
    setError("");
    try {
      await api("campaigns/" + selected + "/" + kind, {});
      setCancel(false);
      await refresh();
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
  const metrics = summary
    ? ([
        ["Recipients", summary.intendedRecipientCount],
        [
          "Queued",
          (summary.counts.PENDING ?? 0) + (summary.counts.QUEUED ?? 0),
        ],
        ["Processing", summary.counts.PROCESSING ?? 0],
        ["Provider accepted", summary.acceptedCount],
        ["Delivered", summary.counts.DELIVERED ?? 0],
        ["Deferred", summary.counts.DEFERRED ?? 0],
        [
          "Bounced",
          (summary.counts.HARD_BOUNCED ?? 0) +
            (summary.counts.SOFT_BOUNCED ?? 0),
        ],
        ["Failed", summary.counts.FAILED ?? 0],
        ["Suppressed", summary.counts.SUPPRESSED ?? 0],
        ["Unknown", summary.counts.UNKNOWN ?? 0],
        ["Cancelled", summary.counts.CANCELLED ?? 0],
        ["Complaints", summary.counts.COMPLAINED ?? 0],
      ] as [string, number][])
    : [];
  return (
    <>
      <PageTitle
        eyebrow="ACTIVITY"
        title="Every send, accounted for."
        description="Follow campaign progress, manage sending, and inspect recipient outcomes."
        action={
          <Button
            startIcon={<ShieldOutlined />}
            onClick={() => {
              setSuppressionOpen(true);
              void inspectSuppression();
            }}
          >
            Suppressions
          </Button>
        }
      />
      <Failure error={error} />
      {loading ? (
        <Loading />
      ) : !campaigns.length ? (
        <Card sx={{ p: { xs: 3, sm: 6 }, textAlign: "center" }}>
          <GraphicEq sx={{ fontSize: 46, color: "primary.main", mb: 2 }} />
          <Typography variant="h5">Your campaigns will appear here.</Typography>
          <Typography color="text.secondary" sx={{ my: 2 }}>
            Create your first message in Blast. Activity will track it as it
            sends.
          </Typography>
          <Button variant="contained" href="/blast" startIcon={<Add />}>
            Create a campaign
          </Button>
        </Card>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "280px minmax(0,1fr)" },
            gap: 3,
          }}
        >
          <Stack spacing={1.5}>
            <Typography variant="overline" color="text.secondary">
              Campaigns
            </Typography>
            {campaigns.map((c) => (
              <Card
                key={c.id}
                component="button"
                onClick={() => {
                  setSelected(c.id);
                  setSummary(null);
                  setEvents([]);
                  setConnected(false);
                  setDeliveryPage({ items: [], nextCursor: null });
                  window.history.replaceState(
                    null,
                    "",
                    "/activity?campaignId=" + c.id,
                  );
                }}
                sx={{
                  p: 2,
                  textAlign: "left",
                  cursor: "pointer",
                  border: 0,
                  outline: c.id === selected ? "2px solid #2457e0" : "none",
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
            <Card sx={{ p: 5, textAlign: "center", alignSelf: "start" }}>
              <Typography variant="h6">Choose a campaign</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                Open a campaign to see its progress and live events.
              </Typography>
            </Card>
          ) : !summary ? (
            <Loading />
          ) : (
            <Stack spacing={3} sx={{ minWidth: 0 }}>
              <Card sx={{ p: { xs: 2.5, sm: 3 } }}>
                <Stack
                  sx={{ justifyContent: "space-between", gap: 2 }}
                  direction={{ xs: "column", sm: "row" }}
                >
                  <Box>
                    <Stack
                      sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}
                      direction="row"
                    >
                      <Typography
                        variant="h5"
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
                          aria-label="Resume campaign"
                          startIcon={<PlayArrow />}
                          disabled={busy}
                          onClick={() => void action("resume")}
                        >
                          Resume
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
                    <Button
                      href={`/api/campaigns/${selected}/export`}
                      startIcon={<DownloadOutlined />}
                    >
                      Export CSV
                    </Button>
                  </Stack>
                </Stack>
                <SafetyMetrics
                  safety={summary.safety}
                  campaignId={summary.id}
                  refresh={() => {
                    void refresh().catch((e) => setError(e.message));
                  }}
                />
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
                    sx={{ height: 7, borderRadius: 5 }}
                  />
                </Box>
                <Typography sx={{ fontSize: 12 }} color="text.secondary">
                  Acceptance means the provider took responsibility for a
                  message. Delivery is confirmed separately by its webhook.
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "repeat(2,1fr)",
                      sm: "repeat(3,1fr)",
                      xl: "repeat(4,1fr)",
                    },
                    gap: 2.5,
                    mt: 3,
                  }}
                >
                  {metrics.map(([name, value]) => (
                    <Box key={name}>
                      <Typography
                        variant="h5"
                        color={
                          name === "Delivered"
                            ? "success.main"
                            : name === "Unknown" && value
                              ? "warning.main"
                              : "text.primary"
                        }
                      >
                        {value.toLocaleString()}
                      </Typography>
                      <Typography sx={{ fontSize: 12 }} color="text.secondary">
                        {name}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Card>
              <Card sx={{ overflow: "hidden" }}>
                <Tabs
                  value={tab}
                  onChange={(_, v) => setTab(v)}
                  variant="scrollable"
                >
                  <Tab label="Live events" />
                  <Tab label="Recipients" />
                  <Tab label="Provider breakdown" />
                </Tabs>
                <Divider />
                {tab === 0 ? (
                  <>
                    <Stack
                      direction="row"

                      sx={{ gap: 2, alignItems: "center", px: 2.5, py: 2 }}
                    >
                      <Chip
                        size="small"
                        color={connected ? "success" : "default"}
                        label={connected ? "Live" : "Reconnecting"}
                      />
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
                        bgcolor: "#101e32",
                        color: "#d7e4f8",
                        p: 2.5,
                        height: 350,
                        overflow: "auto",
                        fontFamily: "ui-monospace, SFMono-Regular, monospace",
                        fontSize: 12,
                      }}
                    >
                      {!events.length ? (
                        <Typography sx={{ fontSize: 13 }} color="#93a7c5">
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
                                borderBottom: "1px solid #24334a",
                                overflowWrap: "anywhere",
                              }}
                            >
                              <Stack
                                sx={{ gap: 1.5, flexWrap: "wrap" }}
                                direction="row"
                              >
                                <Box component="time" sx={{ color: "#8099b9" }}>
                                  {new Date(e.createdAt).toLocaleTimeString()}
                                </Box>
                                <Box sx={{ color: "#90b3ff" }}>
                                  {e.providerName ?? "EmailSystem"}
                                </Box>
                                <Box>{e.maskedEmail}</Box>
                                <Box
                                  sx={{
                                    color:
                                      e.kind === "DELIVERED"
                                        ? "#70dcac"
                                        : e.kind === "UNKNOWN"
                                          ? "#ffc66f"
                                          : "#d7e4f8",
                                  }}
                                >
                                  {e.kind}
                                </Box>
                              </Stack>
                              <Box sx={{ mt: 0.5, color: "#a1b3cc" }}>
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
                      sx={{ ml: 1, mb: 2 }}
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
                          sx={{ py: 1.5, borderBottom: "1px solid #edf1f7" }}
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
      <Dialog open={cancel} onClose={() => setCancel(false)}>
        <DialogTitle>Cancel remaining sends?</DialogTitle>
        <DialogContent>
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
      </Dialog>
      <Dialog
        open={suppressionOpen}
        onClose={() => setSuppressionOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Suppressed recipients</DialogTitle>
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
            <Button onClick={() => void inspectSuppression()}>Search</Button>
          </Stack>
          <Button
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
              <Box key={s.id} sx={{ py: 1, borderBottom: "1px solid #edf1f7" }}>
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
      </Dialog>
    </>
  );
}
