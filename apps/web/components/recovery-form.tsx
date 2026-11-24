"use client";

import { useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { KeyOutlined, ArrowBackOutlined } from "@mui/icons-material";
import { api } from "./api-client";
import { appPath } from "@emailsystem/core/paths";

export function RecoveryForm({ available }: { available: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  return (
    <Box sx={{
      minHeight: "100dvh",
      display: "grid",
      placeItems: "center",
      p: 2,
      bgcolor: "background.default",
    }}>
      <Card sx={{ p: { xs: 3, sm: 4 }, width: "100%", maxWidth: 440 }}>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Avatar variant="rounded" sx={{ width: 32, height: 32, bgcolor: "primary.main" }}>
              <KeyOutlined fontSize="small" />
            </Avatar>
            <Typography sx={{ fontWeight: 650 }}>EmailBlast</Typography>
          </Stack>
          <Box>
            <Typography component="h1" variant="h4" sx={{ fontSize: 27 }}>
              Recover your account
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1, fontSize: 14 }}>
              Use a one-time recovery code issued by your Railway administrator.
              No email provider is required.
            </Typography>
          </Box>
          {complete ? (
            <>
              <Alert severity="success">
                Password updated. Previous sessions were signed out.
              </Alert>
              <Button href={appPath("/login")} variant="contained">
                Return to sign in
              </Button>
            </>
          ) : !available ? (
            <>
              <Alert severity="info">
                Administrator recovery is currently disabled or has expired.
                Ask your Railway administrator to issue a new recovery code.
              </Alert>
              <Button href={appPath("/login")} startIcon={<ArrowBackOutlined />}>
                Back to sign in
              </Button>
            </>
          ) : (
            <Stack
              spacing={2.5}
              component="form"
              onSubmit={async (event) => {
                event.preventDefault();
                setError("");
                if (password !== confirm) {
                  setError("The new passwords do not match.");
                  return;
                }
                setBusy(true);
                try {
                  await api("auth/recover", {
                    email,
                    code,
                    newPassword: password,
                  });
                  setCode("");
                  setPassword("");
                  setConfirm("");
                  setComplete(true);
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {error && <Alert severity="error">{error}</Alert>}
              <TextField label="Account email" type="email"
                autoComplete="username" required value={email}
                onChange={(e) => setEmail(e.target.value)} />
              <TextField label="One-time recovery code" type="text"
                autoComplete="one-time-code" required value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                helperText="Request this code from the Railway workspace administrator." />
              <TextField label="New password" type="password"
                autoComplete="new-password" required slotProps={{ htmlInput: { minLength: 12 } }}
                value={password} onChange={(e) => setPassword(e.target.value)}
                helperText="Use at least 12 characters." />
              <TextField label="Confirm new password" type="password"
                autoComplete="new-password" required value={confirm}
                onChange={(e) => setConfirm(e.target.value)} />
              <Button variant="contained" type="submit" disabled={busy}>
                {busy ? "Updating password…" : "Set new password"}
              </Button>
              <Button href={appPath("/login")} startIcon={<ArrowBackOutlined />}>
                Back to sign in
              </Button>
            </Stack>
          )}
        </Stack>
      </Card>
    </Box>
  );
}
