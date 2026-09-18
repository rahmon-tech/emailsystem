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
];
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
  defaultExpanded,
  busy,
  run,
}: {
  domain: SenderCatalog["domains"][number];
  defaultExpanded: boolean;
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
    <Accordion disableGutters defaultExpanded={defaultExpanded}>
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
            Add aliases in bulk. Domain-based campaigns distribute deliveries
            consistently across enabled aliases; retries keep a stable assignment.
            Aliases never increase provider capacity.
          </Typography>
          <TextField
            label="Alias names"
            placeholder="info, support, hello, sales"
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
            size="small"
            sx={{ alignSelf: "flex-start" }}
            onClick={() => setLocalParts(suggestedAliases.join(", "))}
          >
            Use 10 suggested aliases
          </Button>
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
        Domains & aliases
      </Button>
      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Domains & aliases"
        width={720}
        mobileFullScreen
      >
        <DialogContent>
          <Stack spacing={2.5}>
            <Failure error={error} />
            <Typography variant="body2" color="text.secondary">
              Domains come from provider configuration. Manage the aliases
              available behind each verified domain here.
            </Typography>
            {data?.domains.map((item, index) => (
              <DomainSenders
                key={item.id}
                domain={item}
                defaultExpanded={index === 0}
                busy={busy}
                run={run}
              />
            ))}
            {data && !data.domains.length && (
              <Typography variant="body2" color="text.secondary">
                No sending domains yet. Saving a provider creates its domain
                and configured aliases here, pending provider authorization evidence.
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
