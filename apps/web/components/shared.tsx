"use client";
import { useId } from "react";
import {
  Box,
  Typography,
  Stack,
  Skeleton,
  Alert,
  Dialog,
  DialogTitle,
  IconButton,
  useMediaQuery,
  useTheme,
  CircularProgress,
} from "@mui/material";
import type { DialogProps } from "@mui/material";
import { Close } from "@mui/icons-material";
export function Status({
  value,
  busy = false,
}: {
  value: string;
  busy?: boolean;
}) {
  const state = value.toUpperCase();
  const color = [
    "HEALTHY",
    "DELIVERED",
    "COMPLETED",
    "PASSED",
    "LIVE",
  ].includes(state)
    ? "success.main"
    : [
          "FAILED",
          "AUTH_ERROR",
          "POLICY_BLOCKED",
          "HARD_BOUNCED",
          "COMPLAINED",
        ].includes(state)
      ? "error.main"
      : [
            "UNKNOWN",
            "PAUSED",
            "UNVERIFIED",
            "SANDBOX",
            "COMPLETED_WITH_ERRORS",
            "THROTTLED",
            "COOLDOWN",
            "RATE_LIMITED",
            "RECONNECTING",
          ].includes(state)
        ? "warning.main"
        : ["SENDING", "PROCESSING", "QUEUED", "PROVIDER_ACCEPTED"].includes(
              state,
            )
          ? "primary.main"
          : "text.secondary";
  const name = value.toLowerCase().replaceAll("_", " ");
  return (
    <Stack
      component="span"
      direction="row"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.8,
        color,
        fontSize: 12,
        fontWeight: 550,
        whiteSpace: "nowrap",
      }}
    >
      {busy ? (
        <CircularProgress
          size={12}
          color="inherit"
          aria-label="Checking connection"
        />
      ) : (
        <Box
          component="span"
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: "currentColor",
            flexShrink: 0,
          }}
        />
      )}
      {busy ? "Checking…" : name.charAt(0).toUpperCase() + name.slice(1)}
    </Stack>
  );
}
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      sx={{
        justifyContent: "space-between",
        gap: 2,
        alignItems: { xs: "stretch", sm: "center" },
        mb: 3,
      }}
    >
      <Box>
        <Typography
          component="h1"
          variant="h4"
          sx={{ fontSize: { xs: 26, sm: 30 } }}
        >
          {title}
        </Typography>
        {description && (
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>
            {description}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
  );
}
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Stack
      sx={{
        alignItems: "center",
        textAlign: "center",
        py: { xs: 5, sm: 7 },
        px: 2,
        gap: 1,
      }}
    >
      <Box
        sx={{
          display: "grid",
          placeItems: "center",
          width: 48,
          height: 48,
          borderRadius: 3,
          bgcolor: "action.selected",
          color: "primary.main",
          mb: 1,
        }}
      >
        {icon}
      </Box>
      <Typography variant="h6">{title}</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 320 }}>
        {description}
      </Typography>
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Stack>
  );
}
export function ResponsiveDialog({
  title,
  width = 480,
  mobileFullScreen = false,
  busy = false,
  onClose,
  children,
  ...props
}: Omit<DialogProps, "title" | "maxWidth" | "fullWidth" | "fullScreen"> & {
  title: React.ReactNode;
  width?: number;
  mobileFullScreen?: boolean;
  busy?: boolean;
}) {
  const id = useId();
  const mobile = useMediaQuery(useTheme().breakpoints.down("sm"));
  return (
    <Dialog
      {...props}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth={false}
      fullScreen={mobileFullScreen && mobile}
      aria-labelledby={id}
      slotProps={{
        paper: {
          sx: {
            maxWidth: mobileFullScreen && mobile ? "100%" : width,
            ...(mobileFullScreen && mobile
              ? { height: "100dvh", maxHeight: "100dvh" }
              : {}),
            "& .MuiDialogContent-root": { px: { xs: 2, sm: 3 } },
          },
        },
      }}
    >
      <DialogTitle
        id={id}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          py: 1,
          px: { xs: 2, sm: 3 },
        }}
      >
        <Box component="span" sx={{ minWidth: 0 }}>
          {title}
        </Box>
        <IconButton
          aria-label="Dismiss dialog"
          disabled={busy}
          onClick={(e) => onClose?.(e, "escapeKeyDown")}
          sx={{ mr: -1 }}
        >
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      {children}
    </Dialog>
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
