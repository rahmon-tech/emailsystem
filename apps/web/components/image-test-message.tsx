"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { ScienceOutlined } from "@mui/icons-material";
import { supportsInlineAttachmentTransport } from "@emailsystem/providers/capabilities";
import { api } from "./api-client";
import { Failure, ResponsiveDialog } from "./shared";
import type { SenderCatalog } from "./sender-settings";

type ProviderChoice = {
  id: string;
  name: string;
  type: string;
  transport: string;
  enabled: boolean;
};

type TestMessage = {
  name: string;
  importId: string;
  senderIdentityId: string;
  subject: string;
  preheader: string;
  cc: string[];
  bcc: string[];
  html: string;
  text: string;
  attachments: {
    filename: string;
    content: string;
    contentType: string;
    disposition: "inline" | "attachment";
    contentId?: string;
  }[];
  tracking: { enabled: boolean };
  startKey: string;
};

type Props = {
  senderCatalog: SenderCatalog | null;
  senderIdentityId: string;
  message: TestMessage;
  disabled: boolean;
};

export function ImageTestMessage({
  senderCatalog,
  senderIdentityId,
  message,
  disabled,
}: Props) {
  const [providers, setProviders] = useState<ProviderChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [providerId, setProviderId] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void api<ProviderChoice[]>("providers")
      .then((rows) => {
        if (active) setProviders(rows);
      })
      .catch((reason) => {
        if (active) setError((reason as Error).message);
      });
    return () => {
      active = false;
    };
  }, []);

  const sender = senderCatalog?.domains
    .flatMap((domain) => domain.senders)
    .find((item) => item.id === senderIdentityId);

  const senderProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.enabled && !!sender?.availableProviderIds.includes(provider.id),
      ),
    [providers, sender],
  );

  const eligibleProviders = useMemo(
    () => senderProviders.filter(supportsInlineAttachmentTransport),
    [senderProviders],
  );

  const show = () => {
    const current = eligibleProviders.some((provider) => provider.id === providerId)
      ? providerId
      : (eligibleProviders[0]?.id ?? "");
    setProviderId(current);
    setResult("");
    setError("");
    setOpen(true);
  };

  const send = async () => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await api<{ status: string; safeError?: string }>(
        "test-message",
        {
          providerId,
          recipient,
          message,
        },
      );
      setResult(
        response.safeError ??
          `The sending service reported “${response.status}” for this test. Test emails are not included in campaign results.`,
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!!sender && !!senderProviders.length && (
        <Stack spacing={1}>
          <Alert severity={eligibleProviders.length ? "success" : "warning"}>
            {eligibleProviders.length
              ? `Embedded image ready · ${eligibleProviders.length} of ${senderProviders.length} sending service${senderProviders.length === 1 ? "" : "s"} can send this message.`
              : `Embedded image unavailable · none of the ${senderProviders.length} available sending service${senderProviders.length === 1 ? "" : "s"} can send this message with the image embedded.`}
          </Alert>
          <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
            {senderProviders.map((provider) => (
              <Chip
                key={provider.id}
                label={provider.name}
                size="small"
                variant={
                  supportsInlineAttachmentTransport(provider) ? "filled" : "outlined"
                }
              />
            ))}
          </Stack>
        </Stack>
      )}
      <Button
        startIcon={<ScienceOutlined />}
        disabled={disabled}
        onClick={show}
      >
        Send a test email
      </Button>
      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        title="Send a test message"
        width={520}
        mobileFullScreen
      >
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Failure error={error} />
            {!eligibleProviders.length && (
              <Alert severity="warning">
                None of the available sending services support this message with
                the image embedded.
              </Alert>
            )}
            <TextField
              select
              label="Sending service"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              disabled={!eligibleProviders.length}
            >
              {eligibleProviders.map((provider) => (
                <MenuItem key={provider.id} value={provider.id}>
                  {provider.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Test recipient"
              type="email"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
            {result && <Alert severity="info">{result}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
          <Button
            variant="contained"
            startIcon={<ScienceOutlined />}
            disabled={busy || !recipient || !providerId}
            onClick={() => void send()}
          >
            {busy ? "Sending…" : "Send test"}
          </Button>
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
}
