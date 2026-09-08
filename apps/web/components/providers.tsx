"use client";
import { SendingSafety } from "./sending-safety";
import { useEffect, useState } from "react";
import {
  Box,
  Card,
  Stack,
  Typography,
  Button,
  Avatar,
  Chip,
  Dialog,
  DialogTitle,
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
} from "@mui/material";
import {
  Add,
  ExpandMore,
  CheckCircleOutlined,
  ScienceOutlined,
  PowerSettingsNew,
  EditOutlined,
  DeleteOutlined,
  Close,
} from "@mui/icons-material";
import {
  catalog,
  definition,
  credentialFields,
  supportsTestMode,
} from "@emailsystem/providers/catalog";
import type { ProviderType } from "@emailsystem/providers/catalog";
import { api, date } from "./api-client";
import { PageTitle, Status, Loading, Failure } from "./shared";
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
export function Providers() {
  const [items, setItems] = useState<ProviderRow[] | null>(null),
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
        eyebrow="CONNECTIONS"
        title="Your sending providers"
        action={<SendingSafety />}
        description="Connect your email services. We’ll check each connection before it can send."
      />
      <Failure error={error} />
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Add a sending provider
        </Typography>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2,minmax(0,1fr))",
              sm: "repeat(3,minmax(0,1fr))",
              lg: "repeat(5,minmax(0,1fr))",
            },
            gap: 1.5,
          }}
        >
          {catalog
            .filter((p) => p.id !== "mock" || allowMock)
            .map((p) => (
              <Button
                key={p.id}
                onClick={() => setSelected({ type: p.id })}
                sx={{
                  bgcolor: "white",
                  color: "text.primary",
                  justifyContent: "flex-start",
                  py: 2,
                  px: 2,
                  border: "1px solid transparent",
                  "&:hover": { borderColor: "primary.main", bgcolor: "white" },
                }}
              >
                <Avatar
                  variant="rounded"
                  sx={{
                    bgcolor: p.color,
                    width: 32,
                    height: 32,
                    fontSize: 12,
                    mr: 1.5,
                    fontWeight: 800,
                  }}
                >
                  {p.name.slice(0, 2)}
                </Avatar>
                {p.name}
              </Button>
            ))}
        </Box>
      </Box>
      <Stack
        direction="row"

        sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
      >
        <Typography variant="h6">Connected providers</Typography>
        <Chip
          size="small"
          label={`${items?.filter((p) => p.enabled).length ?? 0} active`}
        />
      </Stack>
      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <Card sx={{ p: { xs: 4, sm: 7 }, textAlign: "center" }}>
          <Avatar
            sx={{
              mx: "auto",
              mb: 2,
              bgcolor: "#eaf0ff",
              color: "primary.main",
            }}
          >
            <Add />
          </Avatar>
          <Typography variant="h6">No providers configured yet.</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Choose a service above to add your first connection.
          </Typography>
        </Card>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" },
            gap: 2,
          }}
        >
          {items.map((p) => (
            <Card key={p.id} sx={{ p: 2.5 }}>
              <Stack sx={{ gap: 1.5, alignItems: "center" }} direction="row">
                <Avatar
                  variant="rounded"
                  sx={{ bgcolor: definition(p.type).color, fontSize: 14 }}
                >
                  {definition(p.type).name.slice(0, 2)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700 }}>{p.name}</Typography>
                  <Typography sx={{ fontSize: 13 }} color="text.secondary">
                    {definition(p.type).name} · {p.transport.toUpperCase()}
                  </Typography>
                </Box>
                <Status value={p.health} />
              </Stack>
              <Typography sx={{ fontSize: 14, mt: 2 }}>
                {p.settings.fromEmail}
              </Typography>
              <Stack
                direction="row"

                sx={{ gap: 2, mt: 1, mb: 2, flexWrap: "wrap" }}
              >
                <Typography sx={{ fontSize: 13 }} color="text.secondary">
                  Checked {date(p.verifiedAt)}
                </Typography>
                <Typography sx={{ fontSize: 13 }} color="text.secondary">
                  Weight {p.weight}
                </Typography>
                <Typography sx={{ fontSize: 13 }} color="text.secondary">
                  {p.recentAcceptance === null
                    ? "No recent sends"
                    : `${p.recentAcceptance}% accepted today`}
                </Typography>
              </Stack>
              <Stack
                sx={{ justifyContent: "space-between", alignItems: "center" }}
                direction="row"
              >
                <Button
                  startIcon={<CheckCircleOutlined />}
                  disabled={busy === p.id}
                  onClick={() => void run(p.id, "verify")}
                >
                  {busy === p.id ? "Checking…" : "Verify"}
                </Button>
                <Stack direction="row">
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
                  <Tooltip title="Disable">
                    <IconButton
                      aria-label={`Disable ${p.name}`}
                      disabled={!p.enabled || busy === p.id}
                      onClick={() => void run(p.id, "disable")}
                    >
                      <PowerSettingsNew fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton
                      aria-label={`Delete ${p.name}`}
                      onClick={() => setRemove(p)}
                    >
                      <DeleteOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
              {p.verifications[0] && (
                <Accordion
                  disableGutters
                  sx={{
                    boxShadow: "none",
                    "&:before": { display: "none" },
                    mt: 1,
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography sx={{ fontSize: 14 }}>
                      Verification details
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={1.5}>
                      {p.verifications[0].checks.map((check, i) => (
                        <Box key={i}>
                          <Stack
                            sx={{ alignItems: "center" }}
                            direction="row"
                            spacing={1}
                          >
                            <Chip
                              size="small"
                              label={check.status}
                              color={
                                check.status === "passed"
                                  ? "success"
                                  : check.status === "failed"
                                    ? "warning"
                                    : "default"
                              }
                              variant="outlined"
                            />
                            <Typography sx={{ fontWeight: 600, fontSize: 14 }}>
                              {check.name}
                            </Typography>
                          </Stack>
                          <Typography
                            color="text.secondary"

                            sx={{ fontSize: 13, mt: 0.5 }}
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
      )}
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
      <Dialog open={!!remove} onClose={() => setRemove(null)}>
        <DialogTitle>Delete this connection?</DialogTitle>
        <DialogContent>
          Future sending through {remove?.name} will stop. Its past delivery
          records remain available.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemove(null)}>Keep connection</Button>
          <Button
            color="error"
            onClick={async () => {
              if (remove) await run(remove.id, "delete");
              setRemove(null);
            }}
          >
            Delete connection
          </Button>
        </DialogActions>
      </Dialog>
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
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {row ? "Edit" : "Connect"} {d.name}
        <IconButton
          onClick={onClose}
          disabled={busy}
          aria-label="Close provider form"
        >
          <Close />
        </IconButton>
      </DialogTitle>
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
                    gridTemplateColumns: "1fr 1fr",
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
      <DialogActions sx={{ p: 3 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy}
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
    </Dialog>
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
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Test {row.name}</DialogTitle>
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
    </Dialog>
  );
}
