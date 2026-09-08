"use client";
import { Box, Chip, Typography, Stack, Skeleton, Alert } from "@mui/material";
export function Status({ value }: { value: string }) {
  const color = ["HEALTHY", "DELIVERED", "COMPLETED"].includes(value)
    ? "success"
    : [
          "FAILED",
          "AUTH_ERROR",
          "POLICY_BLOCKED",
          "HARD_BOUNCED",
          "COMPLAINED",
        ].includes(value)
      ? "error"
      : [
            "UNKNOWN",
            "PAUSED",
            "UNVERIFIED",
            "SANDBOX",
            "COMPLETED_WITH_ERRORS",
          ].includes(value)
        ? "warning"
        : "default";
  return (
    <Chip
      label={value.toLowerCase().replaceAll("_", " ")}
      size="small"
      color={color}
      variant="outlined"
    />
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}

      sx={{
        justifyContent: "space-between",
        gap: 2,
        alignItems: { xs: "stretch", sm: "center" },
        mb: 4,
      }}
    >
      <Box>
        <Typography
          color="primary.main"

          sx={{ fontWeight: 700, fontSize: 12, letterSpacing: 1.3, mb: 1 }}
        >
          {eyebrow}
        </Typography>
        <Typography variant="h4" sx={{ fontSize: { xs: 28, sm: 32 } }}>
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 640 }}>
          {description}
        </Typography>
      </Box>
      {action}
    </Stack>
  );
}
export function Loading() {
  return (
    <Stack spacing={2} aria-label="Loading">
      <Skeleton variant="rounded" height={90} />
      <Skeleton variant="rounded" height={220} />
    </Stack>
  );
}
export function Failure({ error }: { error: string }) {
  return error ? (
    <Alert severity="error" sx={{ mb: 2 }}>
      {error}
    </Alert>
  ) : null;
}
