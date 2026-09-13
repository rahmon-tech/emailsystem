"use client";
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { DeleteOutlined, GraphicEq } from "@mui/icons-material";
import { api } from "./api-client";
import { ResponsiveDialog, Status } from "./shared";

type CampaignRow = {
  id: string;
  name: string;
  state: string;
  intendedRecipientCount: number;
  createdAt: string;
};
type Page<T> = { items: T[]; nextCursor: string | null };

const terminal = new Set([
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "FAILED",
  "CANCELLED",
]);

export function SavedCampaigns() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    void api<Page<CampaignRow>>("campaigns")
      .then((page) => {
        setRows(page.items);
        setNext(page.nextCursor);
      })
      .catch(() => {
        /* Activity itself surfaces campaign-loading errors. */
      });
  }, []);

  if (!rows.length && !open) return null;

  const close = () => {
    setOpen(false);
    if (changed) window.location.reload();
  };

  return (
    <>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
        <Button
          size="small"
          color="inherit"
          startIcon={<GraphicEq />}
          onClick={() => setOpen(true)}
        >
          Manage campaigns{rows.length ? ` (${rows.length})` : ""}
        </Button>
      </Box>
      <ResponsiveDialog
        open={open}
        onClose={close}
        title="Manage campaigns"
        width={620}
        busy={!!busy}
      >
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography color="text.secondary" sx={{ fontSize: 13, mb: 2 }}>
            Remove finished campaigns from Activity without deleting their delivery history. Active campaigns must be cancelled or allowed to finish first.
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {!rows.length ? (
            <Typography color="text.secondary">No campaigns.</Typography>
          ) : (
            <Stack spacing={1}>
              {rows.map((row) => {
                const removable = terminal.has(row.state);
                return (
                  <Stack
                    key={row.id}
                    direction="row"
                    sx={{
                      alignItems: "center",
                      gap: 1.5,
                      minWidth: 0,
                      py: 1.25,
                      borderBottom: 1,
                      borderColor: "divider",
                    }}
                  >
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Stack
                        direction="row"
                        sx={{ alignItems: "center", gap: 1, minWidth: 0 }}
                      >
                        <Typography
                          sx={{
                            minWidth: 0,
                            fontSize: 14,
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={row.name}
                        >
                          {row.name}
                        </Typography>
                        <Status value={row.state} />
                      </Stack>
                      <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5 }}>
                        {row.intendedRecipientCount.toLocaleString()} recipients ·{" "}
                        {new Date(row.createdAt).toLocaleString()}
                      </Typography>
                    </Box>
                    <Tooltip
                      title={
                        removable
                          ? "Remove from Activity"
                          : "Cancel the campaign or wait for it to finish before removing it"
                      }
                    >
                      <span>
                        <IconButton
                          aria-label={`Remove ${row.name}`}
                          color="error"
                          disabled={!!busy || !removable}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                `Remove ${row.name} from Activity? Delivery history will be preserved.`,
                              )
                            )
                              return;
                            setBusy(row.id);
                            setError("");
                            try {
                              await api(`campaigns/${row.id}`, undefined, "DELETE");
                              setRows((current) =>
                                current.filter((item) => item.id !== row.id),
                              );
                              const url = new URL(window.location.href);
                              if (url.searchParams.get("campaignId") === row.id) {
                                url.searchParams.delete("campaignId");
                                window.history.replaceState(null, "", url.toString());
                              }
                              setChanged(true);
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy("");
                            }
                          }}
                        >
                          <DeleteOutlined />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                );
              })}
            </Stack>
          )}
          {next && (
            <Button
              sx={{ mt: 2 }}
              disabled={!!busy}
              onClick={() => {
                void api<Page<CampaignRow>>(`campaigns?cursor=${next}`)
                  .then((page) => {
                    setRows((current) => [
                      ...current,
                      ...page.items.filter(
                        (item) => !current.some((row) => row.id === item.id),
                      ),
                    ]);
                    setNext(page.nextCursor);
                  })
                  .catch((e) => setError((e as Error).message));
              }}
            >
              Load older campaigns
            </Button>
          )}
        </Box>
      </ResponsiveDialog>
    </>
  );
}
