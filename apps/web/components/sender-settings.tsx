"use client";
import { useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  DialogActions,
  DialogContent,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { AlternateEmail, ExpandMore } from "@mui/icons-material";
import { api } from "./api-client";
import { Failure, ResponsiveDialog, Status } from "./shared";

export type SenderCatalog = {
  domains: {
    id: string;
    domain: string;
    status: string;
    senders: {
      id: string;
      email: string;
      localPart: string;
      displayName: string;
      replyTo: string;
      enabled: boolean;
      availableProviderIds: string[];
    }[];
    providers: {
      id: string;
      name: string;
      type: string;
      connectionHealth: string;
      status: string;
      scope: string;
      safeDetail: string | null;
    }[];
  }[];
};

function DomainSenders({
  domain,
  busy,
  run,
}: {
  domain: SenderCatalog["domains"][number];
  busy: boolean;
  run: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const [localParts, setLocalParts] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const parts = localParts
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    <Accordion disableGutters>
      <AccordionSummary expandIcon={<ExpandMore />}>
        <Stack
          direction="row"
          sx={{ alignItems: "center", gap: 1.5, minWidth: 0 }}
        >
          <Typography noWrap sx={{ fontWeight: 600 }}>
            {domain.domain}
          </Typography>
          <Status value={domain.status} />
          <Typography variant="caption" color="text.secondary">
            {domain.senders.length} sender
            {domain.senders.length === 1 ? "" : "s"}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Add aliases in bulk. A campaign keeps one selected sender for every
            recipient; aliases do not increase provider capacity.
          </Typography>
          <TextField
            label="Alias names"
            placeholder="news, billing, events, sales"
            value={localParts}
            onChange={(event) => setLocalParts(event.target.value)}
            helperText={`${parts.length} unique-looking entr${parts.length === 1 ? "y" : "ies"}; separate with commas, spaces, or new lines.`}
            multiline
            minRows={2}
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              fullWidth
            />
            <TextField
              label="Reply-to (optional)"
              value={replyTo}
              onChange={(event) => setReplyTo(event.target.value)}
              fullWidth
            />
          </Stack>
          <Button
            variant="outlined"
            disabled={busy || !parts.length}
            onClick={() =>
              void run(async () => {
                await api(`senders/${domain.id}/add`, {
                  localParts: parts,
                  displayName,
                  replyTo,
                });
                setLocalParts("");
              })
            }
            sx={{ alignSelf: "flex-start" }}
          >
            Add sender aliases
          </Button>
          {!!domain.senders.length && <Divider />}
          {domain.senders.map((sender) => (
            <Stack
              key={sender.id}
              direction={{ xs: "column", sm: "row" }}
              sx={{
                gap: 1,
                alignItems: { xs: "stretch", sm: "center" },
                justifyContent: "space-between",
              }}
            >
              <Stack sx={{ minWidth: 0 }}>
                <Typography noWrap>{sender.email}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {sender.availableProviderIds.length} eligible provider
                  {sender.availableProviderIds.length === 1 ? "" : "s"}
                  {sender.displayName ? ` · ${sender.displayName}` : ""}
                </Typography>
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={sender.enabled}
                    disabled={busy}
                    onChange={(_, enabled) =>
                      void run(() =>
                        api(
                          `senders/${sender.id}/${enabled ? "enable" : "disable"}`,
                          {},
                        ),
                      )
                    }
                  />
                }
                label={sender.enabled ? "Enabled" : "Disabled"}
              />
            </Stack>
          ))}
          {!!domain.providers.length && <Divider />}
          {domain.providers.map((provider) => (
            <Stack key={provider.id} spacing={0.4}>
              <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {provider.name}
                </Typography>
                <Status value={provider.status} />
                <Typography variant="caption" color="text.secondary">
                  {provider.scope.toLowerCase().replaceAll("_", " ")}
                </Typography>
              </Stack>
              {provider.safeDetail && (
                <Typography variant="caption" color="text.secondary">
                  {provider.safeDetail}
                </Typography>
              )}
            </Stack>
          ))}
          {!domain.providers.length && (
            <Typography variant="caption" color="warning.main">
              No provider is associated yet. Configure and verify a provider
              using an address on this domain; this screen never claims
              authorization without provider evidence.
            </Typography>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export function SenderSettings() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SenderCatalog | null>(null);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => setData(await api<SenderCatalog>("senders"));
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        startIcon={<AlternateEmail />}
        onClick={() => {
          setOpen(true);
          void run(refresh);
        }}
      >
        Senders
      </Button>
      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Domains & senders"
        width={720}
        mobileFullScreen
      >
        <DialogContent>
          <Stack spacing={2.5}>
            <Failure error={error} />
            <Typography variant="body2" color="text.secondary">
              Campaigns use verified sender identities—not arbitrary From text.
              The same domain can be authorized by several providers.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                label="Sending domain"
                placeholder="example.com"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                fullWidth
              />
              <Button
                variant="outlined"
                disabled={busy || !domain.trim()}
                onClick={() =>
                  void run(async () => {
                    await api("senders/domain", { domain });
                    setDomain("");
                  })
                }
              >
                Add domain
              </Button>
            </Stack>
            {data?.domains.map((item) => (
              <DomainSenders
                key={item.id}
                domain={item}
                busy={busy}
                run={run}
              />
            ))}
            {data && !data.domains.length && (
              <Typography variant="body2" color="text.secondary">
                No sender domains yet. Saving a provider also creates its sender
                identity here, pending verification evidence.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogActions>
      </ResponsiveDialog>
    </>
  );
}
