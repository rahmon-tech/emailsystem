"use client";
import { TrackingSettings } from "./tracking-settings";
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
  name: string;
  type: ProviderType;
  transport: "api" | "smtp";
  settings: {
    fromEmail: string;
    fromName: string;
    replyTo: string;
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
  credentialHint: string;
  recentAcceptance: number | null;
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
        action === "verify" ? "Verification finished." : "Provider updated.",
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
        title="Providers"
        description="Your sending connections, at a glance."
        action={
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              justifyContent: { xs: "space-between", sm: "flex-end" },
              flexWrap: "wrap",
              rowGap: 1,
            }}
          >
            <SendingSafety />
            <TrackingSettings />
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => setPicker(true)}
            >
              Add provider
            </Button>
          </Stack>
        }
      />
      <Failure error={error} />
      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HubOutlined />}
            title="No providers yet"
            description="Connect your first sending service."
            action={
              <Button startIcon={<Add />} onClick={() => setPicker(true)}>
                Add provider
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
              Connections{" "}
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
                  transition: "border-color 160ms",
                  "&:hover": { borderColor: "text.disabled" },
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
                <Typography sx={{ mt: 2, fontSize: 13 }}>
                  {p.settings.fromEmail}
                </Typography>
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
                  <Status
                    value={p.enabled ? p.health : "DISABLED"}
                    busy={busy === p.id}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {p.recentAcceptance === null
                      ? "No recent sends"
                      : `${p.recentAcceptance}% accepted today`}
                  </Typography>
                </Stack>
                <Stack
                  direction="row"
                  sx={{
                    alignItems: "center",
                    justifyContent: "space-between",
                    mt: 1.5,
                    pt: 1.5,
                    borderTop: 1,
                    borderColor: "divider",
                    gap: 1,
                  }}
                >
                  <Tooltip
                    title={`Last verified: ${date(p.verifiedAt)} · Weight ${p.weight} · ${p.perMinute}/min`}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {p.verifiedAt
                        ? `Verified ${new Date(p.verifiedAt).toLocaleDateString()}`
                        : "Not verified"}
                    </Typography>
                  </Tooltip>
                  <Stack direction="row" spacing={0.25}>
                    <Tooltip title="Verify connection">
                      <IconButton
                        aria-label={`Verify ${p.name}`}
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
                        Verification details
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
        title="Add provider"
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
          onSaved={async () => {
            setSelected(null);
            await reload();
            setToast("Provider saved. Review its verification result.");
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
const labels: Record<string, string> = {
  apiKey: "API key",
  secretKey: "Secret key",
  serverToken: "Server token",
  accessKeyId: "Access Key ID",
  secretAccessKey: "Secret Access Key",
  sessionToken: "Session token (optional)",
  username: "SMTP username",
  password: "SMTP password",
  webhookSecret: "Webhook secret / signing key",
  webhookPublicKey: "Webhook verification public key",
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
  onSaved: () => Promise<void>;
}) {
  const d = definition(type);
  const [transport, setTransport] = useState<"api" | "smtp">(
      row?.transport ?? d.transports[0],
    ),
    [name, setName] = useState(row?.name ?? ""),
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
    [weight, setWeight] = useState(row?.weight ?? 1),
    [second, setSecond] = useState(row?.perSecond ?? 1),
    [minute, setMinute] = useState(row?.perMinute ?? 30),
    [concurrency, setConcurrency] = useState(row?.concurrency ?? 1),
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
            label="Connection name"
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
          {type === "mailgun" && (
            <TextField
              label="Mailgun sending domain"
              value={settings.domain ?? ""}
              onChange={(e) => change("domain", e.target.value)}
              required
            />
          )}
          {type === "postmark" && (
            <>
              <TextField
                select
                label="Message Stream type"
                value={settings.messageStreamType ?? "broadcast"}
                onChange={(e) => {
                  change("messageStreamType", e.target.value);
                  change(
                    "messageStream",
                    e.target.value === "broadcast" ? "broadcast" : "outbound",
                  );
                }}
              >
                <MenuItem value="broadcast">Broadcast — campaigns</MenuItem>
                <MenuItem value="transactional">
                  Transactional — test only
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
                  Campaigns require a Broadcast stream. This connection can be
                  used for explicit test emails.
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
          <Typography sx={{ fontWeight: 700 }}>Sending identity</Typography>
          <TextField
            label="From email"
            type="email"
            value={settings.fromEmail}
            onChange={(e) => change("fromEmail", e.target.value)}
            required
          />
          <TextField
            label="From name"
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
              <Typography>Sending limits and webhooks</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Typography sx={{ fontSize: 13 }} color="text.secondary">
                  Use limits within your provider’s allowance. Connections for
                  the same provider and sending domain share a conservative
                  limit.
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                    gap: 2,
                  }}
                >
                  <TextField
                    label="Weight"
                    type="number"
                    value={weight}
                    onChange={(e) => setWeight(Number(e.target.value))}
                  />
                  <TextField
                    label="Concurrent sends"
                    type="number"
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                  />
                  <TextField
                    label="Recipients / second"
                    type="number"
                    value={second}
                    onChange={(e) => setSecond(Number(e.target.value))}
                  />
                  <TextField
                    label="Recipients / minute"
                    type="number"
                    value={minute}
                    onChange={(e) => setMinute(Number(e.target.value))}
                  />
                </Box>
                {transport === "smtp" && (
                  <>
                    {d.smtp ? (
                      <TextField
                        select
                        label="Port and security"
                        value={settings.port ?? d.smtp.port}
                        onChange={(e) => {
                          change("port", Number(e.target.value));
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
                        value={settings.port ?? 587}
                        onChange={(e) => change("port", Number(e.target.value))}
                      />
                    )}
                    <TextField
                      label="Connection timeout (milliseconds)"
                      type="number"
                      value={settings.timeout}
                      slotProps={{ htmlInput: { min: 5000, max: 60000 } }}
                      onChange={(e) =>
                        change("timeout", Number(e.target.value))
                      }
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
                {d.webhook !== "none" && (
                  <>
                    <Typography sx={{ fontSize: 14 }}>
                      Delivery notifications
                    </Typography>
                    <Typography sx={{ fontSize: 13 }} color="text.secondary">
                      {row
                        ? `Endpoint: ${appUrl}/api/webhooks/${row.id}`
                        : "The endpoint is shown here after you save the connection."}
                    </Typography>
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
                      />
                    ))}
                    <Typography sx={{ fontSize: 13 }} color="text.secondary">
                      {["resend", "mailgun", "sendgrid"].includes(type)
                        ? "Copy the verification key from your provider’s webhook settings."
                        : type === "ses"
                          ? "Use the exact SNS topic ARN for this SES account and region."
                          : type === "elastic"
                            ? "Append ?key=YOUR_WEBHOOK_SECRET to the endpoint in Elastic Email."
                            : "Configure HTTP Basic authentication: username emailsystem, password your webhook secret."}
                    </Typography>
                  </>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
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
              await api(
                row ? `providers/${row.id}` : "providers",
                {
                  name,
                  type,
                  transport,
                  settings,
                  credentials: secrets,
                  weight,
                  perSecond: second,
                  perMinute: minute,
                  concurrency,
                },
                row ? "PUT" : "POST",
              );
              await onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving and verifying…" : "Save & Verify"}
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
            A small test email will use this exact connection. Provider quotas
            and charges may apply.
          </Typography>
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
                  ? "Use non-delivery test mode (may be billed)"
                  : row.type === "brevo"
                    ? "Validate format only (no delivery)"
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
                    ? "Provider validated the test without delivery"
                    : "Provider accepted the test"
                  : result.status}
              </Typography>
              <Typography sx={{ fontSize: 13 }}>
                {result.safeError ??
                  (result.testMode
                    ? "No email was delivered. Sandbox validation does not confirm mailbox delivery."
                    : "Acceptance does not yet confirm mailbox delivery.")}
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
          disabled={busy || !recipient}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setResult(
                await api(`providers/${row.id}/test`, { recipient, testMode }),
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
              ? "Run Non-Delivery Test"
              : "Send Test Email"}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
