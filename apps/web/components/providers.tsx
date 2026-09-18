"use client";
import { TrackingSettings } from "./tracking-settings";
import { SenderSettings } from "./sender-settings";
import type { SenderCatalog } from "./sender-settings";
import { SendingSafety } from "./sending-safety";
import { useEffect, useState } from "react";
import {
  Box,
  Card,
  Stack,
  Typography,
  Button,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  ToggleButtonGroup,
  ToggleButton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  FormControlLabel,
  Alert,
  Snackbar,
  IconButton,
  Tooltip,
  Menu,
  ListItemIcon,
  alpha,
} from "@mui/material";
import {
  Add,
  ExpandMore,
  CheckCircleOutlined,
  ScienceOutlined,
  PowerSettingsNew,
  EditOutlined,
  DeleteOutlined,
  MoreHoriz,
  HubOutlined,
  NorthEastRounded,
  CloudQueue,
  AlternateEmail,
  GridView,
  ForumOutlined,
  MarkEmailReadOutlined,
  AirplanemodeActive,
  SwapHoriz,
  DynamicFeed,
  DnsOutlined,
} from "@mui/icons-material";
import {
  catalog,
  definition,
  credentialFields,
  supportsTestMode,
} from "@emailsystem/providers/catalog";
import type { ProviderType } from "@emailsystem/providers/catalog";
import { api, date } from "./api-client";
import {
  PageTitle,
  Status,
  Loading,
  Failure,
  EmptyState,
  ResponsiveDialog,
} from "./shared";
export interface ProviderRow {
  id: string;
  bootstrapKey?: string | null;
  name: string;
  type: ProviderType;
  transport: "api" | "smtp";
  settings: {
    fromEmail: string;
    fromName: string;
    replyTo: string;
    senderDomain?: string;
    senderAliases?: string[];
    region?: string;
    domain?: string;
    messageStream?: string;
    messageStreamType?: "broadcast" | "transactional";
    postmarkCredentialMode?: "smtp_token" | "server_token";
    host?: string;
    port?: number;
    security?: string;
    timeout?: number;
    mockMode?: string;
  };
  enabled: boolean;
  health: string;
  verifiedAt: string | null;
  weight: number;
  perSecond: number;
  perMinute: number;
  concurrency: number;
  dailyBudgetOverride: number | null;
  monthlyBudgetOverride: number | null;
  credentialHint: string;
  recentAcceptance: number | null;
  domainAuthorizations: {
    status: string;
    scope: string;
    safeDetail: string | null;
    authorizedDomain: { id: string; domain: string; status: string };
  }[];
  verifications: {
    status: string;
    checks: { name: string; status: string; detail: string }[];
    createdAt: string;
  }[];
}
// Distinct symbolic treatments from the existing MUI icon set; no remote brand assets.
const providerIcons = {
  resend: NorthEastRounded,
  ses: CloudQueue,
  mailgun: AlternateEmail,
  sendgrid: GridView,
  brevo: ForumOutlined,
  postmark: MarkEmailReadOutlined,
  mailjet: AirplanemodeActive,
  smtp2go: SwapHoriz,
  elastic: DynamicFeed,
  smtp: DnsOutlined,
  mock: ScienceOutlined,
};
function ProviderMark({ type }: { type: ProviderType }) {
  const Icon = providerIcons[type];
  return (
    <Box
      sx={{
        display: "grid",
        placeItems: "center",
        width: 42,
        height: 42,
        flexShrink: 0,
        borderRadius: 2.5,
        bgcolor: alpha(definition(type).color, 0.12),
        color: "text.primary",
      }}
    >
      <Icon sx={{ fontSize: 23 }} />
    </Box>
  );
}
export function Providers() {
  const [items, setItems] = useState<ProviderRow[] | null>(null),
    [picker, setPicker] = useState(false),
    [menu, setMenu] = useState<{
      anchor: HTMLElement;
      row: ProviderRow;
    } | null>(null),
    [allowMock, setAllowMock] = useState(false),
    [appUrl, setAppUrl] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [selected, setSelected] = useState<{
      type: ProviderType;
      row?: ProviderRow;
    } | null>(null),
    [test, setTest] = useState<ProviderRow | null>(null),
    [remove, setRemove] = useState<ProviderRow | null>(null),
    [busy, setBusy] = useState<string | null>(null);
  const reload = async () => {
    const rows = await api<ProviderRow[]>("providers");
    setItems(rows);
  };
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<ProviderRow[]>("providers"),
      api<{ allowMock: boolean; appUrl: string }>("me"),
    ])
      .then(([rows, me]) => {
        if (active) {
          setItems(rows);
          setAllowMock(me.allowMock);
          setAppUrl(me.appUrl);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  const run = async (id: string, action: string) => {
    setBusy(id);
    setError("");
    try {
      await api(`providers/${id}/${action}`, {});
      await reload();
      setToast(
        action === "verify" ? "Connection check finished." : "Sending service updated.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <PageTitle
        title="Sending services"
        description="Connect and manage the services that send your email campaigns."
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setPicker(true)}
          >
            Add sending service
          </Button>
        }
      />
      <Card sx={{ p: { xs: 1.5, sm: 2 }, mb: 2.5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          sx={{
            gap: 1.25,
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
              Settings shared across all sending services
            </Typography>
            <Typography variant="caption" color="text.secondary">
              These settings affect all sending services. Login details, sending
              domains, From addresses, limits, and delivery updates stay with each service.
            </Typography>
          </Box>
          <Stack
            direction="row"
            sx={{ gap: 0.5, flexWrap: "wrap", flexShrink: 0 }}
          >
            <SendingSafety />
            <SenderSettings />
            <TrackingSettings />
          </Stack>
        </Stack>
      </Card>
      <Failure error={error} />
      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HubOutlined />}
            title="No sending services yet"
            description="Connect the first service you want to use for sending email."
            action={
              <Button startIcon={<Add />} onClick={() => setPicker(true)}>
                Add sending service
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Stack
            direction="row"
            sx={{
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1.5,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Sending services{" "}
              <Box component="span" sx={{ color: "text.secondary", ml: 0.5 }}>
                {items.length}
              </Box>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {items.filter((p) => p.enabled).length} active
            </Typography>
          </Stack>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "repeat(2,minmax(0,1fr))" },
              gap: 2,
            }}
          >
            {items.map((p) => (
              <Card
                key={p.id}
                sx={{
                  p: { xs: 2, sm: 2.5 },
                  alignSelf: "start",
                  transition: "box-shadow 160ms ease, transform 160ms ease",
                  "&:hover": {
                    boxShadow:
                      "0 2px 4px rgb(22 31 49 / 5%), 0 10px 28px rgb(22 31 49 / 6%)",
                  },
                }}
              >
                <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
                  <ProviderMark type={p.type} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 650 }}>{p.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {definition(p.type).name} · {p.transport.toUpperCase()}
                    </Typography>
                  </Box>
                  <Tooltip title="More actions">
                    <IconButton
                      aria-label={`More actions for ${p.name}`}
                      onClick={(e) =>
                        setMenu({ anchor: e.currentTarget, row: p })
                      }
                      sx={{ mr: -1 }}
                    >
                      <MoreHoriz fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Stack spacing={0.35} sx={{ mt: 2 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                    {p.settings.senderDomain ??
                      p.settings.fromEmail.split("@")[1] ??
                      "Sending domain"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {(p.settings.senderAliases?.length ?? 1)} From address
                    {(p.settings.senderAliases?.length ?? 1) === 1 ? "" : "es"} ·{" "}
                    {p.dailyBudgetOverride?.toLocaleString() ?? "Shared limit"}/24h ·{" "}
                    {p.monthlyBudgetOverride?.toLocaleString() ?? "No monthly limit"}/month
                  </Typography>
                </Stack>
                <Stack
                  direction="row"
                  sx={{
                    mt: 1.5,
                    alignItems: "center",
                    gap: 1,
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                  }}
                >
                  <Status value={p.health} busy={busy === p.id} />
                  <Typography variant="caption" color="text.secondary">
                    {p.recentAcceptance === null
                      ? "No recent sends"
                      : `${p.recentAcceptance}% accepted today`}
                  </Typography>
                </Stack>
                {p.domainAuthorizations.map((authorization) => (
                  <Stack
                    key={authorization.authorizedDomain.id}
                    direction="row"
                    sx={{
                      mt: 1,
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {authorization.authorizedDomain.domain}
                    </Typography>
                    <Status value={authorization.status} />
                  </Stack>
                ))}
                <Stack
                  direction="row"
                  sx={{
                    alignItems: "center",
                    justifyContent: "space-between",
                    mt: 1.5,
                    pt: 0.5,
                    gap: 1,
                  }}
                >
                  <Tooltip
                    title={`Last checked: ${date(p.verifiedAt)} · traffic share ${p.weight} · up to ${p.perMinute} emails/min`}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {p.verifiedAt
                        ? `Checked ${new Date(p.verifiedAt).toLocaleDateString()}`
                        : "Not checked"}
                    </Typography>
                  </Tooltip>
                  <Stack direction="row" spacing={0.25}>
                    <Tooltip title="Check connection">
                      <IconButton
                        aria-label={`Check ${p.name}`}
                        disabled={busy === p.id}
                        onClick={() => void run(p.id, "verify")}
                      >
                        <CheckCircleOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Send test email">
                      <IconButton
                        aria-label={`Test ${p.name}`}
                        onClick={() => setTest(p)}
                      >
                        <ScienceOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit connection">
                      <IconButton
                        aria-label={`Edit ${p.name}`}
                        onClick={() => setSelected({ type: p.type, row: p })}
                      >
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Stack>
                {p.verifications[0] && (
                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMore />}>
                      <Typography variant="body2">
                        Connection check details
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Stack spacing={1.5}>
                        {p.verifications[0].checks.map((check, i) => (
                          <Box key={i}>
                            <Stack
                              direction="row"
                              sx={{ alignItems: "center", gap: 1 }}
                            >
                              <Status value={check.status} />
                              <Typography
                                variant="body2"
                                sx={{ fontWeight: 600 }}
                              >
                                {check.name}
                              </Typography>
                            </Stack>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ mt: 0.5, display: "block" }}
                            >
                              {check.detail}
                            </Typography>
                          </Box>
                        ))}
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                )}
              </Card>
            ))}
          </Box>
        </>
      )}
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          disabled={!menu?.row.enabled || busy === menu?.row.id}
          onClick={() => {
            if (menu) void run(menu.row.id, "disable");
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <PowerSettingsNew fontSize="small" />
          </ListItemIcon>
          Disable
        </MenuItem>
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            setRemove(menu?.row ?? null);
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <DeleteOutlined fontSize="small" color="error" />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>
      <ResponsiveDialog
        open={picker}
        onClose={() => setPicker(false)}
        title="Add sending service"
        width={660}
        mobileFullScreen
      >
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 2.5 }}>
            Choose a sending service.
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "repeat(2,minmax(0,1fr))",
                sm: "repeat(3,minmax(0,1fr))",
              },
              gap: 1.5,
            }}
          >
            {catalog
              .filter((p) => p.id !== "mock" || allowMock)
              .map((p) => (
                <Button
                  key={p.id}
                  onClick={() => {
                    setPicker(false);
                    setSelected({ type: p.id });
                  }}
                  sx={{
                    flexDirection: "column",
                    gap: 1.5,
                    color: "text.primary",
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    "&:hover": {
                      borderColor: "primary.main",
                      bgcolor: "action.hover",
                    },
                  }}
                >
                  <ProviderMark type={p.id} />
                  <Typography
                    component="span"
                    sx={{ fontSize: 13, fontWeight: 600 }}
                  >
                    {p.name}
                  </Typography>
                </Button>
              ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPicker(false)}>Close</Button>
        </DialogActions>
      </ResponsiveDialog>
      {selected && (
        <ProviderForm
          key={selected.row?.id ?? selected.type}
          type={selected.type}
          row={selected.row}
          appUrl={appUrl}
          onClose={() => setSelected(null)}
          onSaved={async (saved) => {
            await reload();
            if (selected.row) {
              setSelected(null);
              setToast("Sending service updated. Delivery updates are active.");
            } else {
              setSelected({ type: saved.type, row: saved });
              setToast("Connection saved. Finish delivery-update setup to receive delivered, bounced, and complaint results.");
            }
          }}
        />
      )}
      {test && (
        <TestDialog
          row={test}
          onClose={() => setTest(null)}
          onResult={reload}
        />
      )}
      <ResponsiveDialog
        open={!!remove}
        onClose={() => setRemove(null)}
        title="Delete this connection?"
      >
        <DialogContent>
          Future sending through {remove?.name} will stop. Its past delivery
          records remain available.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemove(null)}>Keep connection</Button>
          <Button
            color="error"
            variant="contained"
            startIcon={<DeleteOutlined />}
            onClick={async () => {
              if (remove) await run(remove.id, "delete");
              setRemove(null);
            }}
          >
            Delete connection
          </Button>
        </DialogActions>
      </ResponsiveDialog>
      <Snackbar
        open={!!toast}
        autoHideDuration={5000}
        onClose={() => setToast("")}
        message={toast}
      />
    </>
  );
}
const suggestedAliases = [
  "info",
  "support",
  "hello",
  "contact",
  "sales",
  "updates",
  "news",
  "team",
  "alerts",
  "billing",
] as const;

const aliasValues = (value: string) =>
  [...new Set(
    value
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )].slice(0, 10);

const labels: Record<string, string> = {
  apiKey: "API key",
  managementApiKey: "Management API key",
  secretKey: "Secret key",
  serverToken: "Server token",
  accountToken: "Account token",
  accessKeyId: "Access Key ID",
  secretAccessKey: "Secret Access Key",
  sessionToken: "Session token (optional)",
  username: "SMTP username",
  password: "SMTP password",
  webhookSecret: "Delivery update signing key",
  webhookPublicKey: "Delivery update public key",
  snsTopicArn: "SNS topic ARN",
};
function ProviderForm({
  type,
  row,
  appUrl,
  onClose,
  onSaved,
}: {
  type: ProviderType;
  row?: ProviderRow;
  appUrl: string;
  onClose: () => void;
  onSaved: (saved: ProviderRow) => Promise<void>;
}) {
  const d = definition(type);
  const [transport, setTransport] = useState<"api" | "smtp">(
      row?.transport ?? d.transports[0],
    ),
    [name, setName] = useState(row?.name ?? ""),
    [senderDomain, setSenderDomain] = useState(
      row?.settings.senderDomain ??
        row?.settings.fromEmail?.split("@")[1] ??
        row?.settings.domain ??
        "",
    ),
    [aliases, setAliases] = useState(
      (
        row?.settings.senderAliases?.length
          ? row.settings.senderAliases
          : row?.settings.fromEmail
            ? [row.settings.fromEmail.split("@")[0]]
            : ["info"]
      ).join(", "),
    ),
    [dailyBudget, setDailyBudget] = useState(
      String(row?.dailyBudgetOverride ?? 5000),
    ),
    [monthlyBudget, setMonthlyBudget] = useState(
      String(row?.monthlyBudgetOverride ?? 150000),
    ),
    [settings, setSettings] = useState({
      ...row?.settings,
      fromEmail: row?.settings.fromEmail ?? "",
      fromName: row?.settings.fromName ?? "",
      replyTo: row?.settings.replyTo ?? "",
      region: row?.settings.region ?? d.regions?.[0],
      messageStream: row?.settings.messageStream ?? "broadcast",
      ...(type === "postmark"
        ? {
            messageStreamType:
              row?.settings.messageStreamType ?? ("broadcast" as const),
            postmarkCredentialMode:
              row?.settings.postmarkCredentialMode ?? ("smtp_token" as const),
          }
        : {}),
      timeout: row?.settings.timeout ?? 20000,
      mockMode: row?.settings.mockMode ?? "success",
    }),
    [secrets, setSecrets] = useState<Record<string, string>>({}),
    [weight, setWeight] = useState(String(row?.weight ?? 1)),
    [second, setSecond] = useState(String(row?.perSecond ?? 1)),
    [minute, setMinute] = useState(String(row?.perMinute ?? 30)),
    [concurrency, setConcurrency] = useState(String(row?.concurrency ?? 1)),
    [smtpPort, setSmtpPort] = useState(
      String(row?.settings.port ?? d.smtp?.port ?? 587),
    ),
    [timeout, setTimeout] = useState(
      String(row?.settings.timeout ?? 20000),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const fields = credentialFields(type, transport, settings);
  const change = (key: string, value: unknown) =>
    setSettings((s) => ({ ...s, [key]: value }));
  return (
    <ResponsiveDialog
      open
      onClose={onClose}
      busy={busy}
      title={
        <Stack
          component="span"
          direction="row"
          sx={{ alignItems: "center", gap: 1.5 }}
        >
          <ProviderMark type={type} />
          <span>
            {row ? "Edit" : "Connect"} {d.name}
          </span>
        </Stack>
      }
      width={660}
      mobileFullScreen
    >
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Failure error={error} />
          <Typography sx={{ fontSize: 14 }} color="text.secondary">
            {d.help}{" "}
            {d.website && (
              <a href={d.website} target="_blank" rel="noreferrer">
                Visit {d.name}
              </a>
            )}
          </Typography>
          {d.transports.length > 1 && (
            <ToggleButtonGroup
              value={transport}
              exclusive
              size="small"
              disabled={!!row}
              onChange={(_, v) => {
                if (v) {
                  setTransport(v);
                  setSmtpPort(String(d.smtp?.port ?? 587));
                  change("port", undefined);
                  change("security", undefined);
                }
              }}
            >
              {d.transports.map((t) => (
                <ToggleButton key={t} value={t}>
                  {t.toUpperCase()}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
          <TextField
            label="Name this connection"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          {d.regions && (
            <TextField
              select
              label="Region"
              value={settings.region}
              onChange={(e) => change("region", e.target.value)}
            >
              {d.regions.map((r) => (
                <MenuItem key={r} value={r}>
                  {r}
                </MenuItem>
              ))}
            </TextField>
          )}
          {type === "postmark" && (
            <>
              <TextField
                select
                label="Postmark stream use"
                value={settings.messageStreamType ?? "broadcast"}
                onChange={(e) => {
                  change("messageStreamType", e.target.value);
                  change(
                    "messageStream",
                    e.target.value === "broadcast" ? "broadcast" : "outbound",
                  );
                }}
              >
                <MenuItem value="broadcast">Campaign sending</MenuItem>
                <MenuItem value="transactional">
                  Test emails only
                </MenuItem>
              </TextField>
              <TextField
                label="Message Stream ID"
                value={settings.messageStream}
                onChange={(e) => change("messageStream", e.target.value)}
                required
              />
              {settings.messageStreamType === "transactional" && (
                <Alert severity="info">
                  This Postmark stream is set for test emails, so EmailSystem
                  will not use it for campaigns.
                </Alert>
              )}
              {transport === "smtp" && (
                <TextField
                  select
                  label="SMTP credential type"
                  value={settings.postmarkCredentialMode ?? "smtp_token"}
                  onChange={(e) => {
                    change("postmarkCredentialMode", e.target.value);
                    setSecrets({});
                  }}
                >
                  <MenuItem value="smtp_token">
                    Stream access key and secret key
                  </MenuItem>
                  <MenuItem value="server_token">
                    Server token as username and password
                  </MenuItem>
                </TextField>
              )}
            </>
          )}
          {type === "smtp" && (
            <TextField
              label="SMTP hostname"
              value={settings.host ?? ""}
              onChange={(e) => change("host", e.target.value)}
              required
            />
          )}
          {row && (
            <Alert severity="info">
              Re-enter sending credentials to replace this connection. Existing
              secrets are never displayed.
            </Alert>
          )}
          {fields.map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              type="password"
              autoComplete="new-password"
              required={!field.optional}
              value={secrets[field.key] ?? ""}
              onChange={(e) =>
                setSecrets({ ...secrets, [field.key]: e.target.value })
              }
              helperText={
                field.helpUrl ? (
                  <a
                    href={field.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Where do I get ${field.label}?`}
                  >
                    Where do I get this?
                  </a>
                ) : (
                  "Use the credentials supplied by your mail service."
                )
              }
            />
          ))}
          <Box>
            <Typography sx={{ fontWeight: 700 }}>Sending domain & From addresses</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Choose the domain this service is allowed to send from, then add
              the From addresses you want to use. More addresses do not increase
              the sending limit for this service.
            </Typography>
          </Box>
          <TextField
            label="Sending domain"
            value={senderDomain}
            onChange={(e) => setSenderDomain(e.target.value.toLowerCase())}
            placeholder="example.com"
            required
          />
          <TextField
            label="From address names"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="info, support, hello"
            helperText="Enter up to 10 names before @, such as info, support, or hello. Retries keep the same From address when possible."
            required
          />
          <Button
            size="small"
            sx={{ alignSelf: "flex-start" }}
            onClick={() => setAliases(suggestedAliases.join(", "))}
          >
            Use 10 suggested addresses
          </Button>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 2,
            }}
          >
            <TextField
              label="Daily connection limit"
              type="number"
              value={dailyBudget}
              slotProps={{ htmlInput: { min: 1 } }}
              onChange={(e) => setDailyBudget(e.target.value)}
              helperText="Maximum emails this service may send in any rolling 24-hour period."
              required
            />
            <TextField
              label="Monthly connection limit"
              type="number"
              value={monthlyBudget}
              slotProps={{ htmlInput: { min: 1 } }}
              onChange={(e) => setMonthlyBudget(e.target.value)}
              helperText="Maximum emails this service may send in one calendar month (UTC)."
              required
            />
          </Box>
          <TextField
            label="Default display name"
            value={settings.fromName}
            onChange={(e) => change("fromName", e.target.value)}
          />
          <TextField
            label="Reply-To (optional)"
            value={settings.replyTo}
            onChange={(e) => change("replyTo", e.target.value)}
          />
          {type === "mock" && (
            <TextField
              select
              label="Simulation"
              value={settings.mockMode}
              onChange={(e) => change("mockMode", e.target.value)}
            >
              {[
                "success",
                "delay",
                "temporary",
                "permanent",
                "rate_limit",
                "unknown",
                "bounce",
              ].map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Accordion disableGutters sx={{ "&:before": { display: "none" } }}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography>Advanced sending speed</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Typography sx={{ fontSize: 13 }} color="text.secondary">
                  Keep these values within the limits given by your email service.
                  Connections using the same service and domain may share capacity.
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                    gap: 2,
                  }}
                >
                  <TextField
                    label="Share of sending traffic"
                    type="number"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                  <TextField
                    label="Emails at once"
                    type="number"
                    value={concurrency}
                    onChange={(e) => setConcurrency(e.target.value)}
                  />
                  <TextField
                    label="Emails / second"
                    type="number"
                    value={second}
                    onChange={(e) => setSecond(e.target.value)}
                  />
                  <TextField
                    label="Emails / minute"
                    type="number"
                    value={minute}
                    onChange={(e) => setMinute(e.target.value)}
                  />
                </Box>
                {transport === "smtp" && (
                  <>
                    {d.smtp ? (
                      <TextField
                        select
                        label="Port and security"
                        value={smtpPort}
                        onChange={(e) => {
                          setSmtpPort(e.target.value);
                          change("security", undefined);
                        }}
                      >
                        {d.smtp.ports.map((p) => (
                          <MenuItem key={p.port} value={p.port}>
                            {p.port} ·{" "}
                            {p.security === "tls" ? "Implicit TLS" : "STARTTLS"}
                            {p.port === d.smtp!.port ? " (recommended)" : ""}
                          </MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      <TextField
                        label="Port"
                        type="number"
                        value={smtpPort}
                        slotProps={{ htmlInput: { min: 1, max: 65535 } }}
                        onChange={(e) => setSmtpPort(e.target.value)}
                      />
                    )}
                    <TextField
                      label="Connection timeout (milliseconds)"
                      type="number"
                      value={timeout}
                      slotProps={{ htmlInput: { min: 5000, max: 60000 } }}
                      onChange={(e) => setTimeout(e.target.value)}
                    />
                    {type === "smtp" && (
                      <TextField
                        select
                        label="Security"
                        value={settings.security ?? "starttls"}
                        onChange={(e) => change("security", e.target.value)}
                      >
                        <MenuItem value="starttls">STARTTLS</MenuItem>
                        <MenuItem value="tls">Implicit TLS</MenuItem>
                      </TextField>
                    )}
                  </>
                )}

              </Stack>
            </AccordionDetails>
          </Accordion>
          <Box
            sx={{
              p: 2,
              borderRadius: 2,
              bgcolor: "action.hover",
            }}
          >
            <Stack spacing={1.5}>
              <Typography sx={{ fontWeight: 700 }}>
                Delivery updates
              </Typography>
              {d.webhook === "none" ? (
                <Alert severity="info">
                  This connection can confirm only that the receiving mail server
                  accepted the message. Final delivery needs a delivery callback
                  from the sending service.
                </Alert>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary">
                    Use this callback so EmailSystem can change an accepted email
                    to Delivered, Bounced, or Complained when your sending service
                    reports the final result.
                  </Typography>
                  <TextField
                    label="Delivery update URL"
                    value={row ? `${appUrl}/api/webhooks/${row.id}` : ""}
                    placeholder="Available after Save & check connection"
                    fullWidth
                    slotProps={{ htmlInput: { readOnly: true } }}
                    helperText={
                      row
                        ? "Copy this URL into your sending service's delivery/event webhook settings."
                        : "Save and check the connection once; the permanent URL will appear here immediately."
                    }
                  />
                  {(type === "ses"
                    ? ["snsTopicArn"]
                    : type === "sendgrid"
                      ? ["webhookPublicKey"]
                      : ["webhookSecret"]
                  ).map((key) => (
                    <TextField
                      key={key}
                      label={labels[key]}
                      type="password"
                      autoComplete="new-password"
                      value={secrets[key] ?? ""}
                      onChange={(e) =>
                        setSecrets({ ...secrets, [key]: e.target.value })
                      }
                      helperText={
                        row
                          ? "Leave blank to keep the saved delivery credential unchanged."
                          : "Optional while connecting. Add it now if your sending service already gave it to you."
                      }
                    />
                  ))}
                  {type === "smtp" && (
                    <Alert severity="warning">
                      Custom SMTP cannot prove final inbox delivery by SMTP alone.
                      Your SMTP service must support delivery callbacks and send
                      JSON containing event/status, messageId (or message_id),
                      recipient/email, and timestamp/time to the URL above. Use
                      HTTP Basic username emailsystem and the signing key entered
                      here. Without callbacks, EmailSystem will safely keep the
                      result as accepted instead of guessing Delivered.
                    </Alert>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {["resend", "mailgun", "sendgrid"].includes(type)
                      ? "Register the delivery-update URL with this service, then paste the verification/signing key it gives you here."
                      : type === "ses"
                        ? "Connect this URL through Amazon SNS, then use the exact topic ARN for this SES account and region."
                        : type === "elastic"
                          ? "Register this URL in Elastic Email, then append ?key=YOUR_WEBHOOK_SECRET using the same secret entered here."
                          : "Register this URL in your sending service and use HTTP Basic authentication with username emailsystem and the secret entered here."}
                  </Typography>
                </>
              )}
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          loading={busy}
          startIcon={<CheckCircleOutlined />}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const localParts = aliasValues(aliases);
              const domain = senderDomain.trim().toLowerCase();
              if (!domain || !localParts.length)
                throw new Error("Enter a sending domain and at least one From address.");
              const integer = (
                label: string,
                value: string,
                min: number,
                max: number,
              ) => {
                const trimmed = value.trim();
                const parsed = Number(trimmed);
                if (
                  !trimmed ||
                  !Number.isInteger(parsed) ||
                  parsed < min ||
                  parsed > max
                )
                  throw new Error(
                    `${label} must be a whole number between ${min.toLocaleString()} and ${max.toLocaleString()}.`,
                  );
                return parsed;
              };
              const parsedWeight = integer("Share of sending traffic", weight, 1, 100);
              const parsedSecond = integer("Emails / second", second, 1, 100);
              const parsedMinute = integer("Emails / minute", minute, 1, 6000);
              const parsedConcurrency = integer("Emails at once", concurrency, 1, 20);
              const parsedDailyBudget = integer(
                "Daily connection limit",
                dailyBudget,
                1,
                10000000,
              );
              const parsedMonthlyBudget = integer(
                "Monthly connection limit",
                monthlyBudget,
                1,
                300000000,
              );
              const providerSettings = {
                ...settings,
                ...(transport === "smtp"
                  ? {
                      port: integer("SMTP port", smtpPort, 1, 65535),
                      timeout: integer(
                        "Connection timeout",
                        timeout,
                        5000,
                        60000,
                      ),
                    }
                  : {}),
                senderDomain: domain,
                senderAliases: localParts,
                fromEmail: `${localParts[0]}@${domain}`,
                ...(type === "mailgun" ? { domain } : {}),
              };
              const saved = await api<ProviderRow>(
                row ? `providers/${row.id}` : "providers",
                {
                  name,
                  type,
                  transport,
                  settings: providerSettings,
                  credentials: secrets,
                  weight: parsedWeight,
                  perSecond: parsedSecond,
                  perMinute: parsedMinute,
                  concurrency: parsedConcurrency,
                  dailyBudget: parsedDailyBudget,
                  monthlyBudget: parsedMonthlyBudget,
                },
                row ? "PUT" : "POST",
              );
              await onSaved(saved);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving and checking…" : "Save & check connection"}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
function TestDialog({
  row,
  onClose,
  onResult,
}: {
  row: ProviderRow;
  onClose: () => void;
  onResult: () => Promise<void>;
}) {
  const [recipient, setRecipient] = useState(
      definition(row.type).capabilities.safeTestRecipient ?? "",
    ),
    [catalog, setCatalog] = useState<SenderCatalog | null>(null),
    [senderIdentityId, setSenderIdentityId] = useState(""),
    [testMode, setTestMode] = useState(false),
    [result, setResult] = useState<{
      status: string;
      testMode?: boolean | null;
      providerMessageId?: string;
      safeError?: string;
      createdAt: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const senders =
    catalog?.domains.flatMap((domain) =>
      domain.providers.some((provider) => provider.id === row.id)
        ? domain.senders.filter((sender) => sender.enabled)
        : [],
    ) ?? [];
  useEffect(() => {
    let active = true;
    void api<SenderCatalog>("senders")
      .then((next) => {
        if (!active) return;
        setCatalog(next);
        const available = next.domains.flatMap((domain) =>
          domain.providers.some((provider) => provider.id === row.id)
            ? domain.senders.filter((sender) => sender.enabled)
            : [],
        );
        setSenderIdentityId(
          available.find((sender) => sender.email === row.settings.fromEmail)
            ?.id ??
            available[0]?.id ??
            "",
        );
      })
      .catch((reason) => setError((reason as Error).message));
    return () => {
      active = false;
    };
  }, [row.id, row.settings.fromEmail]);
  return (
    <ResponsiveDialog
      open
      onClose={onClose}
      busy={busy}
      title={`Test ${row.name}`}
      width={520}
      mobileFullScreen
    >
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Failure error={error} />
          <Typography color="text.secondary">
            A small test email will use this exact sending service. Its normal
            sending limits and charges may apply.
          </Typography>
          <TextField
            select
            label="From address"
            value={senderIdentityId}
            onChange={(event) => setSenderIdentityId(event.target.value)}
            helperText="A successful test confirms this From address. The whole domain is used only when the sending service has verified it."
          >
            {senders.map((sender) => (
              <MenuItem key={sender.id} value={sender.id}>
                {sender.email}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Test recipient"
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
          {definition(row.type).capabilities.safeTestRecipient && (
            <Typography sx={{ fontSize: 13 }} color="text.secondary">
              Resend’s test address is selected. Email is sent only when you
              click Send Test Email.
            </Typography>
          )}
          {supportsTestMode(row) && (
            <FormControlLabel
              control={
                <Switch
                  checked={testMode}
                  onChange={(_, checked) => setTestMode(checked)}
                />
              }
              label={
                row.type === "mailgun"
                  ? "Test without delivery (may be billed)"
                  : row.type === "brevo"
                    ? "Check format only (no delivery)"
                    : "Use Sandbox Mode (no delivery)"
              }
            />
          )}{" "}
          {result && (
            <Alert
              severity={result.status === "accepted" ? "success" : "warning"}
            >
              <Typography sx={{ fontWeight: 600 }}>
                {result.status === "accepted"
                  ? result.testMode
                    ? "The sending service validated the test without delivery"
                    : "The sending service accepted the test email"
                  : result.status}
              </Typography>
              <Typography sx={{ fontSize: 13 }}>
                {result.safeError ??
                  (result.testMode
                    ? "No email was delivered. Test-only validation does not confirm mailbox delivery."
                    : "The sending service accepted the email, but final mailbox delivery is not confirmed yet.")}
              </Typography>
              {result.providerMessageId && (
                <Typography sx={{ fontSize: 12 }}>
                  Message ID: {result.providerMessageId}
                </Typography>
              )}
              <Typography sx={{ fontSize: 12 }}>
                {date(result.createdAt)}
              </Typography>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          loading={busy}
          startIcon={<ScienceOutlined />}
          disabled={busy || !recipient || !senderIdentityId}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setResult(
                await api(`providers/${row.id}/test`, {
                  recipient,
                  testMode,
                  senderIdentityId,
                }),
              );
              await onResult();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? "Testing…"
            : testMode
              ? "Run test without delivery"
              : "Send Test Email"}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
