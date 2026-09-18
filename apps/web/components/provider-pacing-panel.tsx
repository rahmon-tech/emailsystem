"use client";

import { useEffect, useState } from "react";
import { Box, Card, Chip, Stack, Typography } from "@mui/material";
import { SpeedOutlined } from "@mui/icons-material";
import { api } from "./api-client";

export type ProviderPacingRow = {
  id: string;
  name: string;
  health: string;
  enabled: boolean;
  configuredPerMinute: number;
  effectivePerMinute: number;
  slowdown: number;
  cooldownUntil: string | null;
  nextAllowedAt: string | null;
  pressure: "disabled" | "blocked" | "cooldown" | "slowed" | "normal";
};

function pressureLabel(row: ProviderPacingRow) {
  if (row.pressure === "blocked") return "Needs review";
  if (row.pressure === "cooldown") return "Temporarily paused";
  if (row.pressure === "slowed") return "Sending slower";
  if (row.pressure === "disabled") return "Turned off";
  return "Ready";
}

export function ProviderPacingPanel() {
  const [rows, setRows] = useState<ProviderPacingRow[] | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = () =>
      void api<ProviderPacingRow[]>("provider-pacing")
        .then((value) => {
          if (live) setRows(value);
        })
        .catch(() => {
          if (live) setRows([]);
        });
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (!rows?.length) return null;

  return (
    <Card sx={{ mt: 2.5, p: { xs: 2, sm: 2.5 } }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: "center", mb: 2 }}>
        <SpeedOutlined fontSize="small" />
        <Box>
          <Typography sx={{ fontWeight: 700 }}>Current sending speed</Typography>
          <Typography variant="caption" color="text.secondary">
            Shows the current speed available from each sending service. Account,
            domain, and campaign limits may reduce the final speed.
          </Typography>
        </Box>
      </Stack>
      <Stack spacing={1.25}>
        {rows.map((row) => (
          <Stack
            key={row.id}
            direction={{ xs: "column", sm: "row" }}
            sx={{
              gap: { xs: 0.75, sm: 2 },
              alignItems: { xs: "flex-start", sm: "center" },
              py: 1,
              borderTop: 1,
              borderColor: "divider",
            }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 650 }}>
                {row.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.effectivePerMinute.toLocaleString()} emails/min
                {row.effectivePerMinute !== row.configuredPerMinute
                  ? ` · limit ${row.configuredPerMinute.toLocaleString()}/min`
                  : ""}
              </Typography>
            </Box>
            <Box sx={{ textAlign: { xs: "left", sm: "right" } }}>
              <Chip size="small" label={pressureLabel(row)} />
              {row.nextAllowedAt && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  Can try again at {new Date(row.nextAllowedAt).toLocaleTimeString()}
                </Typography>
              )}
            </Box>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}
