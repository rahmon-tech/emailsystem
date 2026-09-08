"use client";
import {useRouter} from "next/navigation";
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
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
} from "@mui/icons-material";
import CodeMirror from "@uiw/react-codemirror";
import { html as htmlLanguage } from "@codemirror/lang-html";
import { RichEditor } from "./editor";
import { api } from "./api-client";
import { PageTitle, Failure } from "./shared";
import type { ProviderRow } from "./providers";
type ImportRow = {
  id: string;
  filename: string;
  stats: Record<string, number>;
};
type Preview = { html: string; text: string };
type Flight = {
  ready: boolean;
  problems: string[];
  warnings: string[];
  count: number;
  providers: { id: string; name: string }[];
  previewHtml: string;
  text: string;
  snapshotHash: string;
};
type Attachment = { filename: string; content: string; contentType: string };
export function Blast() {
 const router=useRouter();
  const [providers, setProviders] = useState<ProviderRow[]>([]),
    [imports, setImports] = useState<ImportRow[]>([]),
    [importId, setImportId] = useState(""),
    [paste, setPaste] = useState(""),
    [form, setForm] = useState({
      name: "",
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
    void Promise.all([
      api<ProviderRow[]>("providers"),
      api<ImportRow[]>("imports"),
    ])
      .then(([p, i]) => {
        if (active) {
          setProviders(p);
          setImports(i);
          const first = p.find((x) => x.enabled);
          if (first) {
            setForm((s) =>
              s.from
                ? s
                : {
                    ...s,
                    from: first.settings.fromEmail,
                    fromName: first.settings.fromName,
                    replyTo: first.settings.replyTo,
                  },
            );
            setTestProvider(first.id);
          }
        }
      })
      .catch((e) => setError(e.message));
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
  });
  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError("");
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
    });
  };
  const selected = imports.find((i) => i.id === importId);
  return (
    <>
      <PageTitle
        eyebrow="NEW CAMPAIGN"
        title="Prepare your next send"
        description="Add recipients, shape your message, and check everything before it enters the queue."
      />
      <Failure error={error} />
      {!providers.some((p) => p.enabled) && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Add and verify at least one provider before sending.{" "}
          <Link href="/providers">Go to Providers</Link>
        </Alert>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "minmax(0,1.1fr) minmax(0,1fr)",
          },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Stack spacing={3}>
          <Card sx={{ p: { xs: 2.5, sm: 3 } }}>
            <Stack
              direction="row"
              spacing={1.5}

              sx={{ alignItems: "center", mb: 2.5 }}
            >
              <Chip label="1" color="primary" size="small" />
              <Typography variant="h6">Recipients</Typography>
            </Stack>
            <Box
              sx={{
                border: "1px dashed #bccbeb",
                borderRadius: 2,
                p: 3,
                textAlign: "center",
                bgcolor: "#fbfcff",
              }}
            >
              <UploadFileOutlined
                color="primary"
                sx={{ fontSize: 32, mb: 1 }}
              />
              <Typography sx={{ fontWeight: 600 }}>
                Upload your recipient list
              </Typography>
              <Typography
                color="text.secondary"

                sx={{ fontSize: 13, mt: 0.5, mb: 2 }}
              >
                CSV, TXT or XLSX · one email column is enough
              </Typography>
              <Button variant="outlined" component="label" disabled={!!busy}>
                {busy === "import" ? "Importing…" : "Choose file"}
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
            <Accordion disableGutters sx={{ "&:before": { display: "none" } }}>
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
                onChange={(e) => {
                  setImportId(e.target.value);
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
            {selected && (
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 2 }}>
                {Object.entries(selected.stats).map(([k, v]) => (
                  <Chip
                    size="small"
                    variant="outlined"
                    color={k === "sendable" ? "success" : "default"}
                    key={k}
                    label={`${v.toLocaleString()} ${k}`}
                  />
                ))}
              </Box>
            )}
          </Card>
          <Card sx={{ p: { xs: 2.5, sm: 3 } }}>
            <Stack
              direction="row"
              spacing={1.5}

              sx={{ alignItems: "center", mb: 3 }}
            >
              <Chip label="2" color="primary" size="small" />
              <Typography variant="h6">Message</Typography>
            </Stack>
            <Stack spacing={2.5}>
              <TextField
                label="Campaign name"
                value={form.name}
                onChange={(e) => change("name", e.target.value)}
                required
              />
              <TextField
                label="From email"
                value={form.from}
                onChange={(e) => change("from", e.target.value)}
                required
                helperText="Use the same verified address on each provider you want to rotate."
              />
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                  gap: 2,
                }}
              >
                <TextField
                  label="From name"
                  value={form.fromName}
                  onChange={(e) => change("fromName", e.target.value)}
                />
                <TextField
                  label="Reply-To"
                  value={form.replyTo}
                  onChange={(e) => change("replyTo", e.target.value)}
                />
              </Box>
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
                helperText="The short line shown beside the subject in an inbox."
              />
              <Accordion
                disableGutters
                sx={{ "&:before": { display: "none" } }}
              >
                <AccordionSummary expandIcon={<ExpandMore />}>
                  <Typography sx={{ fontSize: 14 }}>
                    CC, BCC, attachments and scheduling
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
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
                  <ToggleButton value="rich">Rich text</ToggleButton>
                  <ToggleButton value="source">HTML source</ToggleButton>
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
                    Imported HTML stays in source mode to preserve its layout.
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
        <Stack spacing={3} sx={{ position: { lg: "sticky" }, top: 24 }}>
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
                <ToggleButton value="desktop" aria-label="Desktop preview">
                  <DesktopWindowsOutlined fontSize="small" />
                </ToggleButton>
                <ToggleButton value="mobile" aria-label="Mobile preview">
                  <SmartphoneOutlined fontSize="small" />
                </ToggleButton>
                <ToggleButton value="text" aria-label="Plain-text preview">
                  <TextFields fontSize="small" />
                </ToggleButton>
                <ToggleButton value="source" aria-label="Prepared HTML">
                  <Code fontSize="small" />
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Divider />
            <Box
              sx={{
                p: 2,
                bgcolor: "#eaf0f8",
                minHeight: 350,
                display: "flex",
                justifyContent: "center",
              }}
            >
              {!preview ? (
                <Box sx={{ m: "auto", textAlign: "center", p: 3 }}>
                  <Typography color="text.secondary">
                    Your email preview will appear here.
                  </Typography>
                  <Button
                    sx={{ mt: 2 }}
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
                    bgcolor: "white",
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
                <iframe
                  title={`${view} email preview`}
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={preview.html}
                  style={{
                    width: view === "mobile" ? 390 : "100%",
                    height: 520,
                    border: 0,
                    background: "white",
                    borderRadius: view === "mobile" ? 16 : 4,
                  }}
                />
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
                An unsubscribe link is added automatically.
              </Typography>
              {preview && (
                <Button
                  size="small"
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
                  Refresh
                </Button>
              )}
            </Box>
          </Card>
          <Card sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="h6">Ready for a final check?</Typography>
              <Typography sx={{ fontSize: 14 }} color="text.secondary">
                We’ll check the recipients, message, and available sending
                connections.
              </Typography>
              {flight && (
                <Alert severity={flight.ready ? "success" : "warning"}>
                  <Typography sx={{ fontWeight: 700 }}>
                    {flight.ready ? "Ready to send" : "Action required"}
                  </Typography>
                  {flight.problems.map((p) => (
                    <Typography sx={{ fontSize: 14 }} key={p}>
                      {p}
                    </Typography>
                  ))}
                  {flight.ready && (
                    <Typography sx={{ fontSize: 14 }}>
                      {flight.count.toLocaleString()} recipients ·{" "}
                      {flight.providers.length} eligible providers
                    </Typography>
                  )}
                </Alert>
              )}
              {flight?.warnings.map((w) => (
                <Alert key={w} severity="info">
                  {w}
                </Alert>
              ))}
              <Button
                variant="outlined"
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
                {busy === "preflight" ? "Checking…" : "Run pre-flight"}
              </Button>
              <Button
                variant="contained"
                size="large"
                startIcon={<SendOutlined />}
                disabled={!!busy || !flight?.ready}
                onClick={() => setConfirm(true)}
              >
                {form.scheduledAt ? "Schedule campaign" : "Send campaign"}
              </Button>
              <Button
                disabled={!!busy || !form.from || !form.subject}
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
      <Dialog open={confirm} onClose={() => setConfirm(false)}>
        <DialogTitle>
          {form.scheduledAt
            ? "Schedule this campaign?"
            : "Start this campaign?"}
        </DialogTitle>
        <DialogContent>
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
      </Dialog>
      <Dialog open={resetRich} onClose={() => setResetRich(false)}>
        <DialogTitle>Start fresh in rich text?</DialogTitle>
        <DialogContent>
          This clears the current HTML. Keep source mode to preserve an imported
          layout.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetRich(false)}>Keep HTML</Button>
          <Button
            onClick={() => {
              updateMarkup("<p></p>");
              setMode("rich");
              setResetRich(false);
            }}
          >
            Start fresh
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={testOpen}
        onClose={() => setTestOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Test this message</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              select
              label="Provider"
              value={testProvider}
              onChange={(e) => setTestProvider(e.target.value)}
            >
              {providers
                .filter((p) => p.enabled && p.settings.fromEmail === form.from)
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
      </Dialog>
    </>
  );
}
