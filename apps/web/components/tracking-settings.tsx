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
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  LinkOutlined,
  ExpandMore,
  DeleteOutlined,
  CheckCircleOutlined,
} from "@mui/icons-material";
import { api } from "./api-client";
import { Failure, ResponsiveDialog } from "./shared";
export type TrackingConfig = {
  settings: {
    defaultEnabled: boolean;
    defaultDomainId: string | null;
    blockUnknown: boolean;
  };
  domains: {
    id: string;
    hostname: string;
    usable: boolean;
    enabled: boolean;
    txtName: string;
    txtValue: string;
  }[];
  deniedDomains: { id: string; hostname: string }[];
  retentionDays: number;
  linkLifetimeDays: number;
};
export function TrackingSettings() {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<TrackingConfig | null>(null),
    [hostname, setHostname] = useState(""),
    [denied, setDenied] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const refresh = async () => setData(await api<TrackingConfig>("tracking"));
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
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
              Click tracking is optional. Direct links work without any setup.
            </Typography>
            {data && (
              <>
                <Stack spacing={1}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={data.settings.defaultEnabled}
                        disabled={
                          busy ||
                          (!data.settings.defaultEnabled &&
                            !data.domains.some((d) => d.usable))
                        }
                        onChange={(_, checked) =>
                          void save({ defaultEnabled: checked })
                        }
                      />
                    }
                    label="Track clicks by default"
                  />
                  <TextField
                    select
                    label="Default tracking hostname"
                    value={data.settings.defaultDomainId ?? ""}
                    disabled={busy}
                    onChange={(e) =>
                      void save({ defaultDomainId: e.target.value || null })
                    }
                  >
                    <MenuItem value="">Choose a verified hostname</MenuItem>
                    {data.domains
                      .filter((d) => d.usable)
                      .map((d) => (
                        <MenuItem key={d.id} value={d.id}>
                          {d.hostname}
                        </MenuItem>
                      ))}
                  </TextField>
                </Stack>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                  <TextField
                    label="Tracking hostname"
                    placeholder="click.your-domain.com"
                    value={hostname}
                    onChange={(e) => setHostname(e.target.value)}
                    fullWidth
                  />
                  <Button
                    variant="outlined"
                    disabled={busy || !hostname.trim()}
                    onClick={() =>
                      void run(async () => {
                        await api("tracking", { hostname });
                        setHostname("");
                      })
                    }
                  >
                    Add
                  </Button>
                </Stack>
                {data.domains.map((domain) => (
                  <Accordion key={domain.id} disableGutters>
                    <AccordionSummary expandIcon={<ExpandMore />}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ minWidth: 0, alignItems: "center" }}
                      >
                        {domain.usable && (
                          <CheckCircleOutlined
                            color="success"
                            fontSize="small"
                          />
                        )}
                        <Typography noWrap>{domain.hostname}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {domain.usable ? "Verified" : "Needs verification"}
                        </Typography>
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Stack spacing={1.5}>
                        <Typography variant="body2">
                          Add this DNS TXT record, then route this hostname over
                          HTTPS to this app. Your hosting administrator can use
                          the deployment guide.
                        </Typography>
                        <TextField
                          label="TXT name"
                          value={domain.txtName}
                          slotProps={{ input: { readOnly: true } }}
                        />
                        <TextField
                          label="TXT value"
                          value={domain.txtValue}
                          multiline
                          slotProps={{ input: { readOnly: true } }}
                        />
                        <Stack direction="row" spacing={1}>
                          <Button
                            variant="outlined"
                            disabled={busy}
                            onClick={() =>
                              void run(() =>
                                api(`tracking/${domain.id}/verify`, {}),
                              )
                            }
                          >
                            Verify hostname
                          </Button>
                          {domain.enabled && (
                            <Button
                              disabled={busy}
                              color="warning"
                              onClick={() =>
                                void run(() =>
                                  api(`tracking/${domain.id}/disable`, {}),
                                )
                              }
                            >
                              Disable
                            </Button>
                          )}
                        </Stack>
                        {domain.enabled && (
                          <Typography variant="caption" color="text.secondary">
                            Disabling makes links on this hostname unavailable,
                            including previously sent links.
                          </Typography>
                        )}
                      </Stack>
                    </AccordionDetails>
                  </Accordion>
                ))}
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
                          onChange={(e) => setDenied(e.target.value)}
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
                      {data.deniedDomains.map((d) => (
                        <Stack
                          key={d.id}
                          direction="row"
                          sx={{
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <Typography sx={{ overflowWrap: "anywhere" }}>
                            {d.hostname}
                          </Typography>
                          <Tooltip title="Remove denial">
                            <IconButton
                              aria-label={`Remove ${d.hostname}`}
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  api(
                                    `denied-destinations/${d.id}`,
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
                        label="Require known link reputation"
                      />
                      <Typography variant="caption" color="text.secondary">
                        Off by default. Turning this on also blocks sends when
                        reputation checks are unavailable or inconclusive.
                      </Typography>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
                <Typography variant="caption" color="text.secondary">
                  Daily visit totals are retained for {data.retentionDays} days.
                  Links expire after {data.linkLifetimeDays} days. No IP
                  addresses or browser fingerprints are stored. Visits do not
                  prove human engagement.
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
