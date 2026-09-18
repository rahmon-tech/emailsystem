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
        Link tracking
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
              Click tracking is optional. It is off by default. When it is off,
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
                  label="Tracking link base"
                  value={`${data.appUrl}/r/…`}
                  helperText="Tracked links use your own EmailSystem address. No third-party link shortener is needed."
                  slotProps={{ input: { readOnly: true } }}
                />
                <Accordion disableGutters>
                  <AccordionSummary expandIcon={<ExpandMore />}>
                    <Typography>Blocked link destinations</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={1.5}>
                      <Typography variant="body2" color="text.secondary">
                        Add website domains that should never be used in campaign links.
                      </Typography>
                      <Stack
                        direction={{ xs: "column", sm: "row" }}
                        spacing={1}
                      >
                        <TextField
                          label="Blocked website domain"
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
                          <Tooltip title="Remove blocked domain">
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
                        label="Block links we cannot check"
                      />
                      <Typography variant="caption" color="text.secondary">
                        Off by default. When enabled, a link is blocked if its
                        destination cannot be checked instead of being treated as safe.
                      </Typography>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
                <Typography variant="caption" color="text.secondary">
                  Daily click totals are kept for {data.retentionDays}{" "}
                  days; tracked links expire after {data.linkLifetimeDays} days.
                  EmailSystem does not store IP addresses, browser fingerprints,
                  cookies, or request headers. Some visits may come from automated
                  link scanners, so a tracked visit does not prove a person clicked.
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
