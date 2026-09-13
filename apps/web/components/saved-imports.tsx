"use client";
import { useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { DeleteOutline, PeopleOutline } from "@mui/icons-material";
import { api } from "./api-client";
import { ResponsiveDialog } from "./shared";
type ImportRow = {
  id: string;
  filename: string;
  stats: Record<string, number>;
  createdAt: string;
};
export function SavedImports() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    void api<ImportRow[]>("imports")
      .then(setRows)
      .catch(() => {
        /* Blast itself surfaces import-loading errors. */
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
          startIcon={<PeopleOutline />}
          onClick={() => setOpen(true)}
        >
          Saved lists{rows.length ? ` (${rows.length})` : ""}
        </Button>
      </Box>
      <ResponsiveDialog
        open={open}
        onClose={close}
        title="Saved recipient lists"
        width={560}
        busy={!!busy}
      >
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography color="text.secondary" sx={{ fontSize: 13, mb: 2 }}>
            Remove lists you no longer want to reuse. Existing campaigns remain intact.
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {!rows.length ? (
            <Typography color="text.secondary">No saved lists.</Typography>
          ) : (
            <Stack spacing={1}>
              {rows.map((row) => (
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
                    <Typography
                      sx={{
                        fontSize: 14,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={row.filename}
                    >
                      {row.filename}
                    </Typography>
                    <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                      {(row.stats.sendable ?? 0).toLocaleString()} recipients ·{" "}
                      {new Date(row.createdAt).toLocaleString()}
                    </Typography>
                  </Box>
                  <IconButton
                    aria-label={`Remove ${row.filename}`}
                    color="error"
                    disabled={!!busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Remove ${row.filename} from saved recipient lists?`,
                        )
                      )
                        return;
                      setBusy(row.id);
                      setError("");
                      try {
                        await api(`imports/${row.id}`, undefined, "DELETE");
                        setRows((current) =>
                          current.filter((item) => item.id !== row.id),
                        );
                        setChanged(true);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    <DeleteOutline />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      </ResponsiveDialog>
    </>
  );
}
