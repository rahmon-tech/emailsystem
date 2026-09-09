"use client";
import { useState } from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
  IconButton,
  Tooltip,
} from "@mui/material";
import { LinkOutlined, ExpandMore, DeleteOutlined } from "@mui/icons-material";
import { api } from "./api-client";
import { Failure, ResponsiveDialog } from "./shared";

export type TrackingConfig = {
  settings: { defaultEnabled: boolean; blockUnknown: boolean };
  appUrl: string;
  deniedDomains: { id: string; hostname: string }[];
  retentionDays: number;
  linkLifetimeDays: number;
};

export function TrackingSettings() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TrackingConfig | null>(null);
  const [denied, setDenied] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = async () => setData(await api<TrackingConfig>("tracking"));
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
  const save = (patch: Partial<TrackingConfig["settings"]>) =>
    run(() => api("tracking", { ...data!.settings, ...patch }, "PUT"));
  return (
    <>
      <Button
        startIcon={<LinkOutlined />}
        onClick={() => {
          setOpen(true);
          void run(refresh);
        }}
      >
        Link settings
      </Button>
      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Links & tracking"
        width={640}
        mobileFullScreen
      >
        <DialogContent>
          <Stack spacing={2.5}>
            <Failure error={error} />
            <Typography variant="body2" color="text.secondary">
              Click tracking is optional and off by default. When it is off,
              safe destination links remain direct.
            </Typography>
            {data && (
              <>
                <FormControlLabel
                  control={
                    <Switch
                      checked={data.settings.defaultEnabled}
                      disabled={busy}
                      onChange={(_, checked) =>
                        void save({ defaultEnabled: checked })
                      }
                    />
                  }
                  label="Track clicks by default"
                />
                <TextField
                  label="Redirect base"
                  value={`${data.appUrl}/r/…`}
                  helperText="Uses this app’s verified public URL; no third-party shortener is required."
                  slotProps={{ input: { readOnly: true } }}
                />
                <Accordion disableGutters>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography>Destination policy</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={1.5}>
                      <Typography variant="body2" color="text.secondary">
                        Denied domains and their subdomains cannot be sent or
                        redirected to.
                      </Typography>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={1}
                      >
                        <TextField
                          label="Denied destination domain"
                          value={denied}
                          onChange={(event) => setDenied(event.target.value)}
                          fullWidth
                        />
                        <Button
                          disabled={busy || !denied.trim()}
                          onClick={() =>
                            void run(async () => {
                              await api("denied-destinations", {
                                hostname: denied,
                              });
                              setDenied("");
                            })
                          }
                        >
                          Add
                        </Button>
                      </Stack>
                      {data.deniedDomains.map((domain) => (
                        <Stack
                          key={domain.id}
                          direction="row"
                          sx={{
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <Typography sx={{ overflowWrap: "anywhere" }}>
                            {domain.hostname}
                          </Typography>
                          <Tooltip title="Remove denial">
                            <IconButton
                              aria-label={`Remove ${domain.hostname}`}
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  api(
                                    `denied-destinations/${domain.id}`,
                                    undefined,
                                    "DELETE",
                                  ),
                                )
                              }
                            >
                              <DeleteOutlined />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      ))}
                      <FormControlLabel
                        control={
                          <Switch
                            checked={data.settings.blockUnknown}
                            disabled={busy}
                            onChange={(_, checked) =>
                              void save({ blockUnknown: checked })
                            }
                          />
                        }
                        label="Block unknown reputation results"
                      />
                      <Typography variant="caption" color="text.secondary">
                        Off by default. A timeout stays unknown—it is never
                        silently reported as clean.
                      </Typography>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
                <Typography variant="caption" color="text.secondary">
                  Daily aggregate visit totals are kept for {data.retentionDays}
                  days; links expire after {data.linkLifetimeDays} days. No IP
                  address, browser fingerprint, cookies, or request headers are
                  stored. “Likely automated” is heuristic and a visit never
                  confirms a human action.
                </Typography>
              </>
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
