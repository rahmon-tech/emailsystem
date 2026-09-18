"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  DialogActions,
  DialogContent,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  AttachFileOutlined,
  FactCheckOutlined,
  ImageOutlined,
  SendOutlined,
  UploadFileOutlined,
} from "@mui/icons-material";
import { api } from "./api-client";
import { Failure, PageTitle, ResponsiveDialog } from "./shared";
import type { SenderCatalog } from "./sender-settings";
import type { TrackingConfig } from "./tracking-settings";
import { ImageTestMessage } from "./image-test-message";

type ImportRow = {
  id: string;
  filename: string;
  stats: Record<string, number>;
};

type FileAttachment = {
  filename: string;
  content: string;
  contentType: string;
  bytes: number;
};

type InlineImage = FileAttachment & {
  contentId: string;
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
  sender: {
    domainId: string;
    email: string;
    domain: string;
    aliasCount: number;
    eligibleProviderCount: number;
  };
  tracking: { enabled: boolean };
};

const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const maxAttachmentBytes = 5_000_000;
const maxAttachmentCount = 5;

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeImageDestination(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function imageHtml(image: InlineImage, alt: string, destination: string) {
  const imageMarkup = `<img src="cid:${image.contentId}" alt="${escapeAttribute(alt)}" width="1200" style="display:block;width:100%;max-width:1200px;height:auto;border:0;outline:none;text-decoration:none;margin:0 auto" />`;
  const content = destination
    ? `<a href="${escapeAttribute(destination)}" style="display:block;text-decoration:none;border:0">${imageMarkup}</a>`
    : imageMarkup;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:0;margin:0">${content}</td></tr></table>`;
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

const splitValues = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export function ImageBlast() {
  const router = useRouter();
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [senders, setSenders] = useState<SenderCatalog | null>(null);
  const [trackingConfig, setTrackingConfig] = useState<TrackingConfig | null>(null);
  const [tracking, setTracking] = useState({ enabled: false });
  const [importId, setImportId] = useState("");
  const [name, setName] = useState("");
  const [senderDomainId, setSenderDomainId] = useState("");
  const [senderIdentityId, setSenderIdentityId] = useState("");
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [tags, setTags] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [alt, setAlt] = useState("");
  const [altAuthored, setAltAuthored] = useState(false);
  const [imageDestination, setImageDestination] = useState("");
  const [image, setImage] = useState<InlineImage | null>(null);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [startKey] = useState(() => crypto.randomUUID());

  const invalidate = () => {
    setFlight(null);
    setPreview(null);
  };

  useEffect(() => {
    let active = true;
    void api<TrackingConfig>("tracking")
      .then((data) => {
        if (!active) return;
        setTrackingConfig(data);
        setTracking({ enabled: data.settings.defaultEnabled });
        setFlight(null);
        setPreview(null);
      })
      .catch(() => {
        /* Direct sending remains available if tracking settings cannot be loaded. */
      });
    void Promise.all([
      api<ImportRow[]>("imports"),
      api<SenderCatalog>("senders"),
    ])
      .then(([importRows, senderCatalog]) => {
        if (!active) return;
        setImports(importRows);
        setSenders(senderCatalog);
        const firstDomain = senderCatalog.domains.find(
          (domain) =>
            domain.status === "VERIFIED" &&
            domain.senders.some(
              (sender) =>
                sender.enabled && sender.availableProviderIds.length > 0,
            ),
        );
        const first = firstDomain?.senders.find(
          (sender) => sender.enabled && sender.availableProviderIds.length > 0,
        );
        if (firstDomain && first) {
          setSenderDomainId(firstDomain.id);
          setSenderIdentityId(first.id);
        }
      })
      .catch((reason) => setError((reason as Error).message));
    return () => {
      active = false;
    };
  }, []);

  const normalizedImageDestination = normalizeImageDestination(imageDestination);
  const imageDestinationError =
    imageDestination.trim() && normalizedImageDestination === null
      ? "Use a complete http:// or https:// URL."
      : "";
  const html = image
    ? imageHtml(image, alt.trim(), normalizedImageDestination ?? "")
    : "<p></p>";
  const text = alt.trim() || subject.trim();
  const payload = () => ({
    name,
    importId,
    senderDomainId,
    senderIdentityId,
    subject,
    preheader,
    cc: splitValues(cc),
    bcc: splitValues(bcc),
    tags: splitValues(tags),
    scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
    html,
    text,
    attachments: [
      ...(image
        ? [
            {
              filename: image.filename,
              content: image.content,
              contentType: image.contentType,
              contentId: image.contentId,
              disposition: "inline" as const,
            },
          ]
        : []),
      ...attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
        disposition: "attachment" as const,
      })),
    ],
    tracking: { enabled: tracking.enabled },
    startKey,
  });

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  };

  const importRecipients = async (file: File) => {
    await run("import", async () => {
      if (file.size > 10_000_000)
        throw new Error("Choose a recipient file under 10 MB.");
      const body = new FormData();
      body.set("file", file);
      const result = await api<ImportRow>("imports", body);
      setImports((rows) => [result, ...rows]);
      setImportId(result.id);
      invalidate();
    });
  };

  const attachmentBytes = attachments.reduce((sum, item) => sum + item.bytes, 0);

  const selectImage = async (file: File) => {
    await run("image", async () => {
      if (!imageTypes.has(file.type))
        throw new Error("Use a PNG, JPEG, GIF, or WebP image.");
      if (file.size > maxAttachmentBytes)
        throw new Error("Choose an image no larger than 5 MB.");
      if (attachments.length + 1 > maxAttachmentCount)
        throw new Error("The primary image and attachments may total at most 5 files.");
      if (attachmentBytes + file.size > maxAttachmentBytes)
        throw new Error("The primary image and attachments must total at most 5 MB.");
      const content = await fileBase64(file);
      if (!content) throw new Error("The selected image is empty.");
      setImage({
        filename: file.name,
        content,
        contentType: file.type,
        contentId: `image-${crypto.randomUUID()}`,
        bytes: file.size,
      });
      if (!altAuthored)
        setAlt(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
      invalidate();
    });
  };

  const selectAttachments = async (files: File[]) => {
    await run("attachments", async () => {
      if (files.length + (image ? 1 : 0) > maxAttachmentCount)
        throw new Error("The primary image and attachments may total at most 5 files.");
      const totalBytes =
        files.reduce((sum, file) => sum + file.size, 0) + (image?.bytes ?? 0);
      if (totalBytes > maxAttachmentBytes)
        throw new Error("The primary image and attachments must total at most 5 MB.");
      const data = await Promise.all(
        files.map(async (file): Promise<FileAttachment> => ({
          filename: file.name,
          content: await fileBase64(file),
          contentType: file.type || "application/octet-stream",
          bytes: file.size,
        })),
      );
      setAttachments(data);
      invalidate();
    });
  };

  const selectedImport = imports.find((row) => row.id === importId);
  const eligibleDomains =
    senders?.domains
      .map((domain) => {
        const eligibleSenders = domain.senders.filter(
          (sender) => sender.enabled && sender.availableProviderIds.length > 0,
        );
        return {
          ...domain,
          senders: eligibleSenders,
          providerIds: [
            ...new Set(
              eligibleSenders.flatMap((sender) => sender.availableProviderIds),
            ),
          ],
        };
      })
      .filter(
        (domain) => domain.status === "VERIFIED" && domain.senders.length > 0,
      ) ?? [];
  const imageDataUrl = image
    ? `data:${image.contentType};base64,${image.content}`
    : "";
  const displayPreview =
    preview && image
      ? preview.html.replaceAll(`cid:${image.contentId}`, imageDataUrl)
      : preview?.html ?? "";

  return (
    <>
      <PageTitle
        title="Blast"
        description="Image-first mode · send the primary visual as a real inline CID asset."
        action={
          <Button component={Link} href="/blast" variant="outlined">
            Standard mode
          </Button>
        }
      />
      <Failure error={error} />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            lg: "minmax(0,1fr) minmax(360px,.8fr)",
          },
          gap: 2.5,
          alignItems: "start",
        }}
      >
        <Stack spacing={2.5}>
          <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack spacing={2}>
              <Typography variant="h6">1 · Recipients</Typography>
              {selectedImport && (
                <Alert severity="success">
                  {(selectedImport.stats.sendable ?? 0).toLocaleString()} recipients ready from {selectedImport.filename}.
                </Alert>
              )}
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
                      MenuListProps: { sx: { py: 0.5 } },
                    },
                  },
                }}
                onChange={(event) => {
                  setImportId(event.target.value);
                  invalidate();
                }}
              >
                {imports.map((row) => (
                  <MenuItem key={row.id} value={row.id}>
                    {row.filename} · {(row.stats.sendable ?? 0).toLocaleString()}
                  </MenuItem>
                ))}
              </TextField>
              <Button component="label" startIcon={<UploadFileOutlined />}>
                {busy === "import" ? "Importing…" : "Upload recipient file"}
                <input
                  hidden
                  type="file"
                  accept=".csv,.txt,.xlsx"
                  aria-label="Recipient file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importRecipients(file);
                    event.target.value = "";
                  }}
                />
              </Button>
            </Stack>
          </Card>

          <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack spacing={2}>
              <Typography variant="h6">2 · Message</Typography>
              <TextField
                label="Campaign name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  invalidate();
                }}
                required
              />
              <TextField
                select
                label="Sending domain"
                value={senderDomainId}
                onChange={(event) => {
                  const domain = eligibleDomains.find(
                    (item) => item.id === event.target.value,
                  );
                  const sender = domain?.senders[0];
                  if (!domain || !sender) return;
                  setSenderDomainId(domain.id);
                  setSenderIdentityId(sender.id);
                  invalidate();
                }}
                helperText="The verified alias pool and eligible providers are handled automatically."
                required
              >
                {eligibleDomains.map((domain) => (
                  <MenuItem key={domain.id} value={domain.id}>
                    {domain.domain} · {domain.senders.length} alias
                    {domain.senders.length === 1 ? "" : "es"} ·{" "}
                    {domain.providerIds.length} provider
                    {domain.providerIds.length === 1 ? "" : "s"}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Subject"
                value={subject}
                onChange={(event) => {
                  setSubject(event.target.value);
                  invalidate();
                }}
                required
              />
              <TextField
                label="Preview text"
                value={preheader}
                onChange={(event) => {
                  setPreheader(event.target.value);
                  invalidate();
                }}
              />
              <Stack spacing={1.25}>
                <TextField
                  label="CC (comma separated)"
                  value={cc}
                  onChange={(event) => {
                    setCc(event.target.value);
                    invalidate();
                  }}
                />
                <TextField
                  label="BCC (comma separated)"
                  value={bcc}
                  onChange={(event) => {
                    setBcc(event.target.value);
                    invalidate();
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  These addresses receive a copy of every individual email in this campaign and count toward your sending limits.
                </Typography>
              </Stack>
              <TextField
                label="Tags (comma separated)"
                value={tags}
                onChange={(event) => {
                  setTags(event.target.value);
                  invalidate();
                }}
                helperText="Use tags to organize and filter campaigns after launch."
              />
              <TextField
                label="Schedule (your local time)"
                type="datetime-local"
                slotProps={{ inputLabel: { shrink: true } }}
                value={scheduledAt}
                onChange={(event) => {
                  setScheduledAt(event.target.value);
                  invalidate();
                }}
              />
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={tracking.enabled}
                      onChange={(event) => {
                        setTracking({ enabled: event.target.checked });
                        invalidate();
                      }}
                    />
                  }
                  label="Track clicks"
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block" }}
                >
                  {tracking.enabled
                    ? `Links use ${trackingConfig?.appUrl ?? "the configured app URL"}/r/…; the campaign snapshot decides which safe links are rewritten.`
                    : "Tracking is off; safe links stay direct."}
                </Typography>
              </Box>
              <Box
                sx={{
                  border: "1px dashed",
                  borderColor: image ? "success.main" : "divider",
                  borderRadius: 2,
                  p: 2.5,
                  textAlign: "center",
                  bgcolor: "action.hover",
                }}
              >
                <ImageOutlined sx={{ fontSize: 36, color: "text.secondary" }} />
                <Typography sx={{ fontWeight: 650, mt: 1 }}>
                  {image ? image.filename : "Choose the primary email image"}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5, mb: 1.5 }}
                >
                  PNG, JPEG, GIF or WebP · primary image and attachments share the 5-file / 5 MB campaign limit
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ justifyContent: "center", flexWrap: "wrap" }}
                >
                  <Button component="label" variant="outlined">
                    {busy === "image"
                      ? "Reading image…"
                      : image
                        ? "Replace image"
                        : "Choose image"}
                    <input
                      hidden
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      aria-label="Primary email image"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void selectImage(file);
                        event.target.value = "";
                      }}
                    />
                  </Button>
                  {image && (
                    <Button
                      onClick={() => {
                        setImage(null);
                        invalidate();
                      }}
                    >
                      Remove image
                    </Button>
                  )}
                </Stack>
              </Box>
              <TextField
                label="Alt text"
                value={alt}
                onChange={(event) => {
                  const nextAlt = event.target.value;
                  setAlt(nextAlt);
                  setAltAuthored(Boolean(nextAlt.trim()));
                  invalidate();
                }}
                helperText="Also becomes the plain-text fallback when images are unavailable."
                required
              />
              <TextField
                label="Image destination URL (optional)"
                type="url"
                value={imageDestination}
                onChange={(event) => {
                  setImageDestination(event.target.value);
                  invalidate();
                }}
                error={Boolean(imageDestinationError)}
                helperText={
                  imageDestinationError ||
                  "Optional. Makes the whole primary image clickable; existing click tracking applies when enabled."
                }
              />
              <Box>
                <Button component="label" startIcon={<AttachFileOutlined />}>
                  {busy === "attachments" ? "Reading attachments…" : "Add attachments"}
                  <input
                    hidden
                    type="file"
                    multiple
                    aria-label="Attachments"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      if (files.length) void selectAttachments(files);
                      event.target.value = "";
                    }}
                  />
                </Button>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  Ordinary attachments remain separate from the primary inline image.
                </Typography>
                {!!attachments.length && (
                  <Stack
                    direction="row"
                    sx={{ gap: 1, flexWrap: "wrap", mt: 1.25 }}
                  >
                    {attachments.map((attachment, index) => (
                      <Chip
                        key={`${attachment.filename}-${index}`}
                        label={attachment.filename}
                        onDelete={() => {
                          setAttachments((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          );
                          invalidate();
                        }}
                      />
                    ))}
                  </Stack>
                )}
              </Box>
            </Stack>
          </Card>
        </Stack>

        <Stack spacing={2.5} sx={{ position: { lg: "sticky" }, top: { lg: 24 } }}>
          <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack spacing={2}>
              <Typography variant="h6">Preview</Typography>
              {image && !preview && (
                <Box
                  component="img"
                  src={imageDataUrl}
                  alt={alt}
                  sx={{
                    width: "100%",
                    height: "auto",
                    display: "block",
                    borderRadius: 1,
                  }}
                />
              )}
              {preview && (
                <iframe
                  title="Image-first email preview"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={displayPreview}
                  style={{ width: "100%", height: 420, border: 0, display: "block" }}
                />
              )}
              <Button
                variant="outlined"
                disabled={
                  !!busy ||
                  !image ||
                  !subject ||
                  !alt.trim() ||
                  Boolean(imageDestinationError)
                }
                onClick={() =>
                  void run("preview", async () => {
                    setPreview(
                      await api<Preview>("preview", {
                        html,
                        preheader,
                        text,
                      }),
                    );
                  })
                }
              >
                {busy === "preview" ? "Preparing…" : "Prepare preview"}
              </Button>
            </Stack>
          </Card>

          <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack spacing={2}>
              <Typography variant="h6">3 · Pre-flight & send</Typography>
              {flight && (
                <Alert severity={flight.ready ? "success" : "warning"}>
                  {flight.ready
                    ? `${flight.count.toLocaleString()} recipients · ${flight.providers.length} inline-capable provider${flight.providers.length === 1 ? "" : "s"}`
                    : "Resolve the pre-flight issues before sending."}
                </Alert>
              )}
              {flight && (
                <Typography variant="body2" color="text.secondary">
                  {flight.tracking.enabled
                    ? "Tracking on · click links will be rewritten when the campaign snapshot is created."
                    : "Tracking off · safe links stay direct."}
                </Typography>
              )}
              {flight?.problems.map((problem) => (
                <Alert severity="error" key={problem}>
                  {problem}
                </Alert>
              ))}
              {flight?.warnings.map((warning) => (
                <Alert severity="info" key={warning}>
                  {warning}
                </Alert>
              ))}
              <Button
                variant={flight?.ready ? "outlined" : "contained"}
                startIcon={<FactCheckOutlined />}
                disabled={
                  !!busy ||
                  !importId ||
                  !name.trim() ||
                  !senderDomainId ||
                  !senderIdentityId ||
                  !subject.trim() ||
                  !image ||
                  !alt.trim() ||
                  Boolean(imageDestinationError)
                }
                onClick={() =>
                  void run("preflight", async () => {
                    const result = await api<Flight>("preflight", payload());
                    setFlight(result);
                    setPreview({
                      html: result.previewHtml,
                      text: result.text,
                    });
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
                {scheduledAt ? "Schedule campaign" : "Send campaign"}
              </Button>
              <ImageTestMessage
                senderCatalog={senders}
                senderIdentityId={senderIdentityId}
                message={payload()}
                disabled={
                  !!busy ||
                  !senderDomainId ||
                  !senderIdentityId ||
                  !subject.trim() ||
                  !image ||
                  !alt.trim() ||
                  Boolean(imageDestinationError)
                }
              />
            </Stack>
          </Card>
        </Stack>
      </Box>

      <ResponsiveDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        busy={busy === "send"}
        title={
          scheduledAt
            ? "Schedule this image-first campaign?"
            : "Start this image-first campaign?"
        }
      >
        <DialogContent>
          {flight?.count.toLocaleString()} messages will enter the existing background delivery queue. The inline image and any ordinary attachments remain part of the immutable campaign snapshot.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Keep editing</Button>
          <Button
            variant="contained"
            disabled={!!busy}
            onClick={() =>
              void run("send", async () => {
                const result = await api<{ id: string }>("campaigns", payload());
                router.push("/activity?campaignId=" + result.id);
              })
            }
          >
            {busy === "send" ? "Queuing…" : "Confirm send"}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
}
