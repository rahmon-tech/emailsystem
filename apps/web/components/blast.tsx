"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Box,
  Card,
  Stack,
  Typography,
  TextField,
  Button,
  MenuItem,
  Alert,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  ToggleButtonGroup,
  ToggleButton,
  DialogContent,
  DialogActions,
  Divider,
  Collapse,
  IconButton,
  Tooltip,
  FormControlLabel,
  Switch,
  Checkbox,
  ListItemText,
} from "@mui/material";
import {
  UploadFileOutlined,
  ExpandMore,
  DesktopWindowsOutlined,
  SmartphoneOutlined,
  Code,
  TextFields,
  SendOutlined,
  FactCheckOutlined,
  AttachFileOutlined,
  EditNoteOutlined,
  Refresh,
  ScienceOutlined,
  CheckCircleOutlined,
  RadioButtonUnchecked,
  VisibilityOutlined,
} from "@mui/icons-material";
import CodeMirror from "@uiw/react-codemirror";
import { html as htmlLanguage } from "@codemirror/lang-html";
import type { TrackingConfig } from "./tracking-settings";
import type { SenderCatalog } from "./sender-settings";
import { RichEditor } from "./editor";
import { api } from "./api-client";
import { PageTitle, Failure, EmptyState, ResponsiveDialog } from "./shared";
import type { ProviderRow } from "./providers";
type ImportRow = {
  id: string;
  filename: string;
  stats: Record<string, number>;
};
type Preview = { html: string; text: string };
type Flight = {
  tracking: { enabled: boolean; appUrl: string | null };
  sender: {
    id: string;
    domainId: string;
    email: string;
    domain: string;
    domains: string[];
    domainCount: number;
    aliasCount: number;
    eligibleProviderCount: number;
  };
  reputation: { hostname: string; state: string }[];
  ready: boolean;
  problems: string[];
  warnings: string[];
  count: number;
  safety: {
    campaignUnits: number;
    availableUnits: number;
    campaignDaily: number | null;
  };
  providers: { id: string; name: string }[];
  previewHtml: string;
  text: string;
  snapshotHash: string;
};
type Attachment = { filename: string; content: string; contentType: string };
export function Blast() {
  const router = useRouter();
  const [trackingConfig, setTrackingConfig] = useState<TrackingConfig | null>(
    null,
  );
  const [tracking, setTracking] = useState({ enabled: false });
  const [senderCatalog, setSenderCatalog] = useState<SenderCatalog | null>(
    null,
  );
  const [providers, setProviders] = useState<ProviderRow[]>([]),
    [imports, setImports] = useState<ImportRow[]>([]),
    [loaded, setLoaded] = useState(false),
    [importId, setImportId] = useState(""),
    [paste, setPaste] = useState(""),
    [editRecipients, setEditRecipients] = useState(false),
    [form, setForm] = useState({
      name: "",
      senderDomainId: "",
      senderDomainIds: [] as string[],
      senderIdentityId: "",
      from: "",
      fromName: "",
      replyTo: "",
      subject: "",
      preheader: "",
      cc: "",
      bcc: "",
      text: "",
      scheduledAt: "",
      tags: "",
    }),
    [markup, setMarkup] = useState("<p></p>"),
    [mode, setMode] = useState<"rich" | "source">("rich"),
    [preview, setPreview] = useState<Preview | null>(null),
    [view, setView] = useState("desktop"),
    [flight, setFlight] = useState<Flight | null>(null),
    [error, setError] = useState(""),
    [errorAction, setErrorAction] = useState(""),
    [busy, setBusy] = useState(""),
    [confirm, setConfirm] = useState(false),
    [resetRich, setResetRich] = useState(false),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [testOpen, setTestOpen] = useState(false),
    [testRecipient, setTestRecipient] = useState(""),
    [testProvider, setTestProvider] = useState(""),
    [testResult, setTestResult] = useState("");
  const generation = useRef(0),
    startKey = useRef(crypto.randomUUID());
  const invalid = () => {
    generation.current++;
    setFlight(null);
  };
  const change = (key: string, value: string) => {
    setForm((s) => ({ ...s, [key]: value }));
    invalid();
  };
  const updateMarkup = (html: string) => {
    setMarkup(html);
    invalid();
  };
  useEffect(() => {
    let active = true;
    void api<TrackingConfig>("tracking")
      .then((data) => {
        if (!active) return;
        setTrackingConfig(data);
        setTracking({ enabled: data.settings.defaultEnabled });
        generation.current++;
        setFlight(null);
      })
      .catch(() => {
        /* Direct sending remains available. */
      });
    void Promise.all([
      api<ProviderRow[]>("providers"),
      api<ImportRow[]>("imports"),
      api<SenderCatalog>("senders"),
    ])
      .then(([p, i, senderData]) => {
        if (active) {
          setProviders(p);
          setImports(i);
          setSenderCatalog(senderData);
          const firstDomain = senderData.domains.find(
            (domain) =>
              domain.status === "VERIFIED" &&
              domain.senders.some(
                (sender) =>
                  sender.enabled && sender.availableProviderIds.length > 0,
              ),
          );
          const first = firstDomain?.senders.find(
            (sender) =>
              sender.enabled && sender.availableProviderIds.length > 0,
          );
          if (firstDomain && first) {
            setForm((s) =>
              s.senderDomainIds.length
                ? s
                : {
                    ...s,
                    senderDomainId: firstDomain.id,
                    senderDomainIds: [firstDomain.id],
                    senderIdentityId: first.id,
                    from: first.email,
                    fromName: first.displayName,
                    replyTo: first.replyTo,
                  },
            );
            const domainProviders = [
              ...new Set(
                firstDomain.senders.flatMap(
                  (sender) => sender.availableProviderIds,
                ),
              ),
            ];
            setTestProvider(domainProviders[0] ?? "");
          }
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const split = (s: string) =>
    s
      .split(/[,;\n]/)
      .map((v) => v.trim())
      .filter(Boolean);
  const payload = () => ({
    ...form,
    importId,
    html: markup,
    cc: split(form.cc),
    bcc: split(form.bcc),
    tags: split(form.tags),
    text: form.text || undefined,
    scheduledAt: form.scheduledAt
      ? new Date(form.scheduledAt).toISOString()
      : undefined,
    attachments,
    startKey: startKey.current,
    tracking: {
      enabled: tracking.enabled,
    },
  });
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError("");
    setErrorAction(name);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const upload = async (file?: File) => {
    await run("import", async () => {
      if (file && file.size > 10000000)
        throw new Error("Choose a recipient file under 10 MB.");
      const body = new FormData();
      if (file) body.set("file", file);
      else body.set("paste", paste);
      const result = await api<ImportRow>("imports", body);
      setImports((rows) => [result, ...rows]);
      setImportId(result.id);
      invalid();
      setPaste("");
      setEditRecipients(false);
    });
  };
  const selected = imports.find((i) => i.id === importId);
  const eligibleDomains =
    senderCatalog?.domains
      .map((domain) => {
        const senders = domain.senders.filter(
          (sender) => sender.enabled && sender.availableProviderIds.length > 0,
        );
        return {
          ...domain,
          senders,
          providerIds: [
            ...new Set(senders.flatMap((sender) => sender.availableProviderIds)),
          ],
        };
      })
      .filter(
        (domain) => domain.status === "VERIFIED" && domain.senders.length > 0,
      ) ?? [];
  const hasEligibleSender = eligibleDomains.length > 0;
  const selectedDomains = eligibleDomains.filter((domain) =>
    form.senderDomainIds.includes(domain.id),
  );
  const selectedDomain = selectedDomains[0];
  return (
    <>
      <PageTitle
        title="Blast"
        description="Prepare, preview, and launch your next email."
        inlineAction
        action={
          <Button
            component={Link}
            href="/blast/image"
            variant="outlined"
            size="small"
            sx={{ whiteSpace: "nowrap" }}
          >
            Image-first mode
          </Button>
        }
      />
      <Failure
        error={["preflight", "test", "send"].includes(errorAction) ? "" : error}
      />
      {loaded && !hasEligibleSender && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Connect and verify a sending service and domain before sending.{" "}
          <Link href="/providers">Manage sending services and addresses</Link>
        </Alert>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "minmax(0,1.15fr) minmax(0,1fr)",
          },
          gap: 2,
          alignItems: "start",
        }}
      >
        <Stack spacing={2}>
          <Card sx={{ p: { xs: 1.75, sm: 2.25 } }}>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "center", mb: 2.5 }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600 }}
              >
                01
              </Typography>
              <Typography variant="h6">Recipients</Typography>
            </Stack>
            {selected && (
              <Box sx={{ textAlign: "left", mb: 1.5 }}>
                <Typography
                  sx={{
                    fontWeight: 650,
                    fontSize: 20,
                    color: "success.main",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {selected.stats.sendable.toLocaleString()} ready
                </Typography>
                <Stack
                  direction="row"
                  sx={{ gap: 1, flexWrap: "wrap", mt: 0.5 }}
                >
                  {["duplicate", "invalid", "suppressed"].map((k, index) => (
                    <Typography
                      key={k}
                      variant="caption"
                      color="text.secondary"
                    >
                      {index > 0 ? "· " : ""}
                      {(selected.stats[k] ?? 0).toLocaleString()}{" "}
                      {k === "duplicate"
                        ? selected.stats[k] === 1
                          ? "duplicate"
                          : "duplicates"
                        : k === "suppressed"
                          ? "do-not-send"
                          : k}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            )}
            {selected && (
              <Button
                size="small"
                startIcon={<UploadFileOutlined />}
                onClick={() => setEditRecipients((v) => !v)}
                sx={{ mt: 0.5 }}
              >
                {editRecipients ? "Done" : "Change list"}
              </Button>
            )}
            <Collapse in={!selected || editRecipients}>
              <Box
                sx={{
                  border: selected ? 0 : "1px dashed",
                  borderColor: "divider",
                  borderRadius: 2,
                  p: selected ? 0 : 2.5,
                  textAlign: "center",
                  bgcolor: selected ? "transparent" : "action.hover",
                }}
              >
                {!selected && (
                  <>
                    <Typography sx={{ fontWeight: 600 }}>
                      Upload your recipient list
                    </Typography>
                    <Typography
                      color="text.secondary"
                      sx={{ fontSize: 12, mt: 0.5, mb: 1.5 }}
                    >
                      CSV, TXT or XLSX · one email column
                    </Typography>
                  </>
                )}
                <Button
                  variant={selected ? "text" : "outlined"}
                  startIcon={<UploadFileOutlined />}
                  component="label"
                  disabled={!!busy}
                  sx={{ width: selected ? "100%" : "auto" }}
                >
                  {busy === "import"
                    ? "Importing…"
                    : selected
                      ? "Replace list"
                      : "Choose file"}
                  <input
                    hidden
                    type="file"
                    accept=".csv,.txt,.xlsx"
                    aria-label="Recipient file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                      e.target.value = "";
                    }}
                  />
                </Button>
              </Box>
              <Accordion
                disableGutters
                sx={{ "&:before": { display: "none" } }}
              >
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography sx={{ fontSize: 14 }}>
                    Or paste email addresses
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TextField
                    label="One email per line"
                    multiline
                    minRows={4}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                  />
                  <Button
                    sx={{ mt: 1 }}
                    disabled={!!busy || !paste.trim()}
                    onClick={() => void upload()}
                  >
                    Import pasted addresses
                  </Button>
                </AccordionDetails>
              </Accordion>
              {imports.length > 0 && (
                <TextField
                  select
                  label="Recipient import"
                  value={importId}
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
                  onChange={(e) => {
                    setImportId(e.target.value);
                    setEditRecipients(false);
                    invalid();
                  }}
                  sx={{ mt: 2 }}
                >
                  {imports.map((i) => (
                    <MenuItem key={i.id} value={i.id}>
                      {i.filename} · {i.stats.sendable.toLocaleString()}{" "}
                      recipients
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Collapse>
          </Card>
          <Card sx={{ p: { xs: 1.75, sm: 2.25 } }}>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "center", mb: 3 }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 600 }}
              >
                02
              </Typography>
              <Typography variant="h6">Message</Typography>
            </Stack>
            <Stack spacing={2}>
              <TextField
                label="Campaign name"
                value={form.name}
                onChange={(e) => change("name", e.target.value)}
                required
              />
              <TextField
                select
                label="Sending domains"
                value={form.senderDomainIds}
                onChange={(event) => {
                  const raw = event.target.value;
                  const ids =
                    typeof raw === "string" ? raw.split(",") : (raw as string[]);
                  const domain = eligibleDomains.find((item) => item.id === ids[0]);
                  const sender = domain?.senders[0];
                  if (!domain || !sender) {
                    setForm((current) => ({
                      ...current,
                      senderDomainId: "",
                      senderDomainIds: [],
                      senderIdentityId: "",
                      from: "",
                      fromName: "",
                      replyTo: "",
                    }));
                    setTestProvider("");
                    invalid();
                    return;
                  }
                  setForm((current) => ({
                    ...current,
                    senderDomainId: domain.id,
                    senderDomainIds: ids.slice(0, 10),
                    senderIdentityId: sender.id,
                    from: sender.email,
                    fromName: sender.displayName,
                    replyTo: sender.replyTo,
                  }));
                  const providerIds = [
                    ...new Set(
                      eligibleDomains
                        .filter((item) => ids.includes(item.id))
                        .flatMap((item) => item.providerIds),
                    ),
                  ];
                  setTestProvider(providerIds[0] ?? "");
                  invalid();
                }}
                required
                helperText="Choose one or more verified domains. EmailSystem rotates only across currently eligible domains, aliases and provider connections, while preserving each route's own limits."
                slotProps={{
                  select: {
                    multiple: true,
                    renderValue: (selected) =>
                      eligibleDomains
                        .filter((domain) =>
                          (selected as string[]).includes(domain.id),
                        )
                        .map((domain) => domain.domain)
                        .join(", "),
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
              >
                {eligibleDomains.map((domain) => (
                  <MenuItem key={domain.id} value={domain.id}>
                    <Checkbox
                      size="small"
                      checked={form.senderDomainIds.includes(domain.id)}
                    />
                    <ListItemText
                      primary={domain.domain}
                      secondary={`${domain.senders.length} alias${domain.senders.length === 1 ? "" : "es"} · ${domain.providerIds.length} provider${domain.providerIds.length === 1 ? "" : "s"}`}
                    />
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Subject"
                value={form.subject}
                onChange={(e) => change("subject", e.target.value)}
                required
              />
              <TextField
                label="Preview text"
                value={form.preheader}
                onChange={(e) => change("preheader", e.target.value)}
                helperText="Shown beside the subject in an inbox."
              />
              <Accordion
                disableGutters
                sx={{ "&:before": { display: "none" } }}
              >
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography sx={{ fontSize: 14 }}>More options</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                      Sender aliases, display names and Reply-To values stay
                      attached to their provider/domain configuration. This
                      campaign only rotates across the domains selected above.
                    </Typography>

                    <FormControlLabel
                      control={
                        <Switch
                          checked={tracking.enabled}
                          onChange={(_, enabled) => {
                            setTracking({ enabled });
                            invalid();
                          }}
                        />
                      }
                      label="Track clicks"
                    />
                    <Typography variant="caption" color="text.secondary">
                      {tracking.enabled
                        ? `Links use ${trackingConfig?.appUrl ?? "this app"}/r/…; scanner visits are only heuristic analytics.`
                        : "Safe links stay direct. "}
                      {!tracking.enabled && (
                        <Link href="/providers">Manage link settings</Link>
                      )}
                    </Typography>
                    <TextField
                      label="CC (comma separated)"
                      value={form.cc}
                      onChange={(e) => change("cc", e.target.value)}
                    />
                    <TextField
                      label="BCC (comma separated)"
                      value={form.bcc}
                      onChange={(e) => change("bcc", e.target.value)}
                    />
                    <Typography sx={{ fontSize: 13 }} color="text.secondary">
                      These addresses receive a copy of every individual email.
                    </Typography>
                    <TextField
                      label="Schedule (your local time)"
                      type="datetime-local"
                      slotProps={{ inputLabel: { shrink: true } }}
                      value={form.scheduledAt}
                      onChange={(e) => change("scheduledAt", e.target.value)}
                    />
                    <TextField
                      label="Tags (comma separated)"
                      value={form.tags}
                      onChange={(e) => change("tags", e.target.value)}
                    />
                    <Button
                      component="label"
                      startIcon={<AttachFileOutlined />}
                    >
                      Add attachments
                      <input
                        type="file"
                        multiple
                        hidden
                        aria-label="Attachments"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          void run("attachments", async () => {
                            if (
                              files.length > 5 ||
                              files.reduce((n, f) => n + f.size, 0) > 5000000
                            )
                              throw new Error(
                                "Choose at most 5 files totalling 5 MB.",
                              );
                            const data = await Promise.all(
                              files.map(
                                (file) =>
                                  new Promise<Attachment>((resolve, reject) => {
                                    const reader = new FileReader();
                                    reader.onload = () =>
                                      resolve({
                                        filename: file.name,
                                        content: String(reader.result).split(
                                          ",",
                                        )[1],
                                        contentType:
                                          file.type ||
                                          "application/octet-stream",
                                      });
                                    reader.onerror = reject;
                                    reader.readAsDataURL(file);
                                  }),
                              ),
                            );
                            setAttachments(data);
                            invalid();
                          });
                        }}
                      />
                    </Button>
                    {attachments.map((a, i) => (
                      <Chip
                        key={a.filename + i}
                        label={a.filename}
                        onDelete={() => {
                          setAttachments((all) =>
                            all.filter((_, n) => n !== i),
                          );
                          invalid();
                        }}
                      />
                    ))}
                  </Stack>
                </AccordionDetails>
              </Accordion>
              <Stack
                sx={{
                  justifyContent: "space-between",
                  gap: 1,
                  flexWrap: "wrap",
                }}
                direction="row"
              >
                <ToggleButtonGroup
                  size="small"
                  value={mode}
                  exclusive
                  onChange={(_, v) => {
                    if (v === "source") setMode("source");
                    else if (v === "rich" && mode === "source")
                      setResetRich(true);
                  }}
                >
                  <ToggleButton value="rich">
                    <EditNoteOutlined fontSize="small" sx={{ mr: 0.75 }} />
                    Rich text
                  </ToggleButton>
                  <ToggleButton value="source">
                    <Code fontSize="small" sx={{ mr: 0.75 }} />
                    Source
                  </ToggleButton>
                </ToggleButtonGroup>
                <Button
                  component="label"
                  size="small"
                  startIcon={<UploadFileOutlined />}
                >
                  Import HTML
                  <input
                    hidden
                    type="file"
                    accept=".html,.htm"
                    aria-label="HTML file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        void run("html", async () => {
                          if (file.size > 512000)
                            throw new Error("HTML must be under 512 KB.");
                          updateMarkup(await file.text());
                          setMode("source");
                        });
                    }}
                  />
                </Button>
              </Stack>
              {mode === "source" ? (
                <>
                  <Typography sx={{ fontSize: 13 }} color="text.secondary">
                    Source mode preserves your imported layout.
                  </Typography>
                  <CodeMirror
                    value={markup}
                    minHeight="320px"
                    maxHeight="600px"
                    extensions={[htmlLanguage()]}
                    onChange={updateMarkup}
                    aria-label="HTML source"
                  />
                </>
              ) : (
                <RichEditor initialHtml={markup} onChange={updateMarkup} />
              )}
              <Accordion
                disableGutters
                sx={{ "&:before": { display: "none" } }}
              >
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography sx={{ fontSize: 14 }}>
                    Plain-text fallback
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TextField
                    label="Optional plain text"
                    helperText="Generated from your HTML when left blank."
                    multiline
                    minRows={5}
                    value={form.text}
                    onChange={(e) => change("text", e.target.value)}
                  />
                </AccordionDetails>
              </Accordion>
            </Stack>
          </Card>
        </Stack>
        <Stack
          spacing={2.5}
          sx={{
            "@media (min-width:1200px) and (min-height:950px)": {
              position: "sticky",
              top: 24,
            },
          }}
        >
          <Card sx={{ overflow: "hidden" }}>
            <Stack
              direction="row"

              sx={{
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                flexWrap: "wrap",
                p: 2.5,
              }}
            >
              <Typography variant="h6">Preview</Typography>
              <ToggleButtonGroup
                size="small"
                value={view}
                exclusive
                onChange={(_, v) => {
                  if (v) setView(v);
                }}
              >
                <ToggleButton
                  value="desktop"
                  aria-label="Desktop preview"
                  title="Desktop preview"
                >
                  <DesktopWindowsOutlined fontSize="small" />
                </ToggleButton>
                <ToggleButton
                  value="mobile"
                  aria-label="Mobile preview"
                  title="Mobile preview"
                >
                  <SmartphoneOutlined fontSize="small" />
                </ToggleButton>
                <ToggleButton
                  value="text"
                  aria-label="Plain-text preview"
                  title="Plain-text preview"
                >
                  <TextFields fontSize="small" />
                </ToggleButton>
                <ToggleButton
                  value="source"
                  aria-label="Prepared HTML"
                  title="Prepared HTML"
                >
                  <Code fontSize="small" />
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Divider />
            <Box
              sx={{
                p: 2,
                bgcolor: "action.hover",
                minHeight: 350,
                display: "flex",
                justifyContent: "center",
              }}
            >
              {!preview ? (
                <Box sx={{ m: "auto", textAlign: "center" }}>
                  <EmptyState
                    icon={<VisibilityOutlined />}
                    title="Your email, in context"
                    description="Refresh to preview your message."
                  />
                  <Button
                    startIcon={<Refresh />}
                    disabled={!!busy}
                    onClick={() =>
                      void run("preview", async () => {
                        setPreview(
                          await api<Preview>("preview", {
                            html: markup,
                            preheader: form.preheader,
                            text: form.text,
                          }),
                        );
                      })
                    }
                  >
                    Refresh preview
                  </Button>
                </Box>
              ) : view === "text" || view === "source" ? (
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    p: 2,
                    bgcolor: "background.paper",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    width: "100%",
                    fontSize: 13,
                    maxHeight: 550,
                    overflow: "auto",
                  }}
                >
                  {view === "text" ? preview.text : preview.html}
                </Box>
              ) : (
                <Box
                  sx={{
                    width: view === "mobile" ? "min(360px, 100%)" : "100%",
                    minWidth: 0,
                    bgcolor: "background.paper",
                    border: 1,
                    borderColor: "divider",
                    borderRadius: view === "mobile" ? 3 : 1.5,
                    overflow: "hidden",
                    transition: "width 180ms ease",
                  }}
                >
                  <Box
                    sx={{
                      px: 2,
                      py: 1.5,
                      borderBottom: 1,
                      borderColor: "divider",
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {form.fromName
                        ? `${form.fromName} · ${selectedDomain?.domain ?? "Sending domain"}`
                        : selectedDomain?.domain ?? "Sending domain"}
                    </Typography>
                    <Typography
                      sx={{ fontSize: 14, fontWeight: 600, mt: 0.25 }}
                    >
                      {form.subject || "Subject"}
                    </Typography>
                  </Box>
                  <iframe
                    title={`${view} email preview`}
                    sandbox=""
                    referrerPolicy="no-referrer"
                    srcDoc={preview.html}
                    style={{
                      display: "block",
                      width: "100%",
                      height: 390,
                      border: 0,
                    }}
                  />
                </Box>
              )}
            </Box>
            <Box
              sx={{
                px: 2.5,
                py: 1.5,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Typography sx={{ fontSize: 12 }} color="text.secondary">
                Unsubscribe link included automatically.
              </Typography>
              {preview && (
                <Tooltip title="Refresh preview">
                  <IconButton
                    aria-label="Refresh preview"
                    disabled={!!busy}
                    onClick={() =>
                      void run("preview", async () => {
                        setPreview(
                          await api<Preview>("preview", {
                            html: markup,
                            preheader: form.preheader,
                            text: form.text,
                          }),
                        );
                      })
                    }
                  >
                    <Refresh fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Card>
          <Card
            component="section"
            aria-label="Campaign check"
            sx={{ p: { xs: 1.75, sm: 2.25 } }}
          >
            <Stack spacing={2}>
              <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 600 }}
                >
                  03
                </Typography>
                <Typography variant="h6">Check campaign</Typography>
              </Stack>
              <Failure error={errorAction === "preflight" ? error : ""} />
              {!flight && (
                <Typography variant="body2" color="text.secondary">
                  Check recipients, sender, and message before sending.
                </Typography>
              )}
              {flight && (
                <Stack spacing={1.5}>
                  <Typography
                    sx={{
                      fontWeight: 650,
                      color: flight.ready ? "success.main" : "warning.main",
                    }}
                  >
                    {flight.ready ? "Ready to send" : "Action required"}
                  </Typography>
                  <Box
                    sx={{ display: "grid", gridTemplateColumns: "1fr", gap: 1 }}
                  >
                    {[
                      [
                        `${flight.count.toLocaleString()} recipients`,
                        flight.count > 0,
                      ],
                      [
                        `${flight.providers.length} sending ${flight.providers.length === 1 ? "service" : "services"} ready`,
                        flight.providers.length > 0,
                      ],
                      [
                        `${flight.sender.domainCount} sending ${flight.sender.domainCount === 1 ? "domain" : "domains"} · ${flight.sender.aliasCount} From ${flight.sender.aliasCount === 1 ? "address" : "addresses"}`,
                        flight.sender.eligibleProviderCount > 0,
                      ],
                      ["HTML prepared", !!flight.previewHtml],
                      ["Plain text ready", !!flight.text],
                      [
                        flight.tracking.enabled
                          ? `Tracking · ${flight.tracking.appUrl}/r/…`
                          : "Tracking off · direct links",
                        true,
                      ],
                    ].map(([label, ok]) => (
                      <Stack
                        key={String(label)}
                        direction="row"
                        sx={{ alignItems: "center", gap: 1 }}
                      >
                        {ok ? (
                          <CheckCircleOutlined
                            sx={{ fontSize: 17, color: "success.main" }}
                          />
                        ) : (
                          <RadioButtonUnchecked
                            sx={{ fontSize: 17, color: "text.secondary" }}
                          />
                        )}
                        <Typography variant="body2">{label}</Typography>
                      </Stack>
                    ))}
                  </Box>
                  {flight.problems.map((p) => (
                    <Alert severity="error" key={p}>
                      {p}
                    </Alert>
                  ))}
                </Stack>
              )}
              {flight && (
                <Typography variant="body2" color="text.secondary">
                  {flight.safety.campaignUnits.toLocaleString()} emails needed ·{" "}
                  {flight.safety.availableUnits.toLocaleString()} can send now
                  {flight.safety.campaignUnits > flight.safety.availableUnits
                    ? ". The rest will wait and continue automatically as sending capacity becomes available."
                    : "."}
                </Typography>
              )}
              {flight?.warnings.map((w) => (
                <Alert key={w} severity="info">
                  {w}
                </Alert>
              ))}
              <Button
                variant={flight?.ready ? "outlined" : "contained"}
                loading={busy === "preflight"}
                startIcon={<FactCheckOutlined />}
                disabled={!!busy || !importId}
                onClick={() =>
                  void run("preflight", async () => {
                    const version = generation.current;
                    const result = await api<Flight>("preflight", payload());
                    if (version !== generation.current) return;
                    setFlight(result);
                    setPreview({ html: result.previewHtml, text: result.text });
                  })
                }
              >
                {busy === "preflight" ? "Checking…" : "Check campaign"}
              </Button>
              <Button
                variant={flight?.ready ? "contained" : "outlined"}
                size="large"
                startIcon={<SendOutlined />}
                disabled={!!busy || !flight?.ready}
                onClick={() => setConfirm(true)}
              >
                {form.scheduledAt ? "Schedule campaign" : "Send campaign"}
              </Button>
              <Button
                startIcon={<ScienceOutlined />}
                disabled={!!busy || !form.senderIdentityId || !form.subject}
                onClick={() => {
                  setTestOpen(true);
                  setTestResult("");
                }}
              >
                Send a test email
              </Button>
            </Stack>
          </Card>
        </Stack>
      </Box>
      <ResponsiveDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        busy={busy === "send"}
        title={
          form.scheduledAt ? "Schedule this campaign?" : "Start this campaign?"
        }
      >
        <DialogContent>
          <Failure error={errorAction === "send" ? error : ""} />
          {flight?.count.toLocaleString()} individual emails will enter the
          background queue. You can follow progress and pause sending in
          Activity.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Keep editing</Button>
          <Button
            variant="contained"
            disabled={!!busy}
            onClick={() =>
              void run("send", async () => {
                const result = await api<{ id: string }>(
                  "campaigns",
                  payload(),
                );
                router.push("/activity?campaignId=" + result.id);
              })
            }
          >
            {busy === "send" ? "Queuing…" : "Confirm send"}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
      <ResponsiveDialog
        open={resetRich}
        onClose={() => setResetRich(false)}
        title="Start fresh in rich text?"
      >
        <DialogContent>
          This clears the current HTML. Keep source mode to preserve an imported
          layout.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetRich(false)}>Keep HTML</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              updateMarkup("<p></p>");
              setMode("rich");
              setResetRich(false);
            }}
          >
            Start fresh
          </Button>
        </DialogActions>
      </ResponsiveDialog>
      <ResponsiveDialog
        open={testOpen}
        onClose={() => setTestOpen(false)}
        busy={busy === "test"}
        title="Test this message"
        width={520}
        mobileFullScreen
      >
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Failure error={errorAction === "test" ? error : ""} />
            <TextField
              select
              label="Sending service"
              value={testProvider}
              onChange={(e) => setTestProvider(e.target.value)}
            >
              {providers
                .filter((provider) => {
                  const domain = eligibleDomains.find(
                    (item) => item.id === form.senderDomainId,
                  );
                  return provider.enabled && !!domain?.providerIds.includes(provider.id);
                })
                .map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              label="Test recipient"
              type="email"
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
            />
            {testResult && <Alert severity="info">{testResult}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestOpen(false)}>Close</Button>
          <Button
            variant="contained"
            startIcon={<ScienceOutlined />}
            loading={busy === "test"}
            disabled={!!busy || !testRecipient || !testProvider}
            onClick={() =>
              void run("test", async () => {
                const result = await api<{
                  status: string;
                  safeError?: string;
                }>("test-message", {
                  providerId: testProvider,
                  recipient: testRecipient,
                  message: payload(),
                });
                setTestResult(
                  result.safeError ??
                    `Provider ${result.status} this test. This is separate from campaign statistics.`,
                );
              })
            }
          >
            {busy === "test" ? "Sending…" : "Send test"}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
}
