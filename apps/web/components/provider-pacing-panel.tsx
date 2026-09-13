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
  if (row.pressure === "blocked") return "Policy review";
  if (row.pressure === "cooldown") return "Cooling down";
  if (row.pressure === "slowed") return `${row.slowdown}× adaptive slowdown`;
  if (row.pressure === "disabled") return "Disabled";
  return "Normal";
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
          <Typography sx={{ fontWeight: 700 }}>Live provider pacing</Typography>
          <Typography variant="caption" color="text.secondary">
            Configured capacity versus the current adaptive provider rate. Sender-domain, campaign and account ceilings may reduce the final campaign pace further.
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
                {row.name} pacing
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Configured {row.configuredPerMinute.toLocaleString()}/min · effective {row.effectivePerMinute.toLocaleString()}/min
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
                  Next provider slot {new Date(row.nextAllowedAt).toLocaleTimeString()}
                </Typography>
              )}
            </Box>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
}
