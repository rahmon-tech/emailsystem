"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  AccessTimeOutlined,
  LockOutlined,
  SettingsOutlined,
} from "@mui/icons-material";
import { api } from "./api-client";
import { Failure, Loading, PageTitle } from "./shared";

type WorkspaceSettings = {
  organizationName: string;
  timezone: string;
};

export function Settings() {
  const router = useRouter();
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [password, setPassword] = useState({
    current: "",
    next: "",
    confirm: "",
  });

  useEffect(() => {
    let live = true;
    void Promise.all([
      api<WorkspaceSettings>("settings"),
      api<{ email: string }>("me"),
    ])
      .then(([workspace, me]) => {
        if (!live) return;
        setSettings(workspace);
        setEmail(me.email);
      })
      .catch((reason) => {
        if (live) setError((reason as Error).message);
      });
    return () => {
      live = false;
    };
  }, []);

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setSaved("");
    try {
      await operation();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <PageTitle
        title="Settings"
        description="Workspace identity and account security. Sending controls stay with the features they affect."
      />
      <Failure error={error} />
      {!settings ? (
        error ? null : <Loading />
      ) : (
        <Stack spacing={2.5} sx={{ maxWidth: 760 }}>
          {saved && <Alert severity="success">{saved}</Alert>}

          <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack
              direction="row"
              sx={{ gap: 1, alignItems: "center", mb: 2.5 }}
            >
              <SettingsOutlined fontSize="small" />
              <Stack spacing={0.25}>
                <Typography variant="h6">Workspace</Typography>
                <Typography variant="body2" color="text.secondary">
                  Name this installation and choose the timezone used for
                  operational context.
                </Typography>
              </Stack>
            </Stack>
            <Stack
              component="form"
              spacing={2}
              onSubmit={(event) => {
                event.preventDefault();
                void run("workspace", async () => {
                  const result = await api<WorkspaceSettings>(
                    "settings",
                    settings,
                    "PUT",
                  );
                  setSettings(result);
                  setSaved("Workspace settings saved.");
                  router.refresh();
                });
              }}
            >
              <TextField
                label="Workspace name"
                value={settings.organizationName}
                onChange={(event) =>
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          organizationName: event.target.value,
                        }
                      : current,
                  )
                }
                helperText="Shown beneath the EmailBlast name. This does not change the product branding."
                required
              />
              <Stack
                direction={{ xs: "column", sm: "row" }}
                sx={{ gap: 1, alignItems: { xs: "stretch", sm: "flex-start" } }}
              >
                <TextField
                  label="Timezone"
                  value={settings.timezone}
                  onChange={(event) =>
                    setSettings((current) =>
                      current
                        ? { ...current, timezone: event.target.value }
                        : current,
                    )
                  }
                  helperText="Use an IANA timezone such as Africa/Lagos, America/Los_Angeles or Europe/London."
                  required
                />
                <Button
                  startIcon={<AccessTimeOutlined />}
                  sx={{ flexShrink: 0, mt: { sm: 0.25 } }}
                  onClick={() => {
                    const timezone =
                      Intl.DateTimeFormat().resolvedOptions().timeZone;
                    if (timezone)
                      setSettings((current) =>
                        current ? { ...current, timezone } : current,
                      );
                  }}
                >
                  Use this device
                </Button>
              </Stack>
              <Button
                type="submit"
                variant="contained"
                disabled={!!busy}
                sx={{ alignSelf: "flex-start" }}
              >
                {busy === "workspace" ? "Saving…" : "Save workspace"}
              </Button>
            </Stack>
          </Card>

          <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack
              direction="row"
              sx={{ gap: 1, alignItems: "center", mb: 2 }}
            >
              <LockOutlined fontSize="small" />
              <Stack spacing={0.25}>
                <Typography variant="h6">Account security</Typography>
                <Typography variant="body2" color="text.secondary">
                  Changing your password signs out every active session.
                </Typography>
              </Stack>
            </Stack>
            <TextField
              label="Sign-in email"
              value={email}
              slotProps={{ input: { readOnly: true } }}
              sx={{ mb: 2 }}
            />
            <Divider sx={{ mb: 2 }} />
            <Stack
              component="form"
              spacing={2}
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                setSaved("");
                if (password.next !== password.confirm) {
                  setError("The new passwords do not match.");
                  return;
                }
                void run("password", async () => {
                  await api("settings/password", {
                    currentPassword: password.current,
                    newPassword: password.next,
                  });
                  await api("auth/logout", {});
                  router.replace("/login");
                  router.refresh();
                });
              }}
            >
              <TextField
                label="Current password"
                type="password"
                autoComplete="current-password"
                value={password.current}
                onChange={(event) =>
                  setPassword((current) => ({
                    ...current,
                    current: event.target.value,
                  }))
                }
                required
              />
              <TextField
                label="New password"
                type="password"
                autoComplete="new-password"
                value={password.next}
                onChange={(event) =>
                  setPassword((current) => ({
                    ...current,
                    next: event.target.value,
                  }))
                }
                helperText="Use 12–256 characters."
                slotProps={{ htmlInput: { minLength: 12, maxLength: 256 } }}
                required
              />
              <TextField
                label="Confirm new password"
                type="password"
                autoComplete="new-password"
                value={password.confirm}
                onChange={(event) =>
                  setPassword((current) => ({
                    ...current,
                    confirm: event.target.value,
                  }))
                }
                required
              />
              <Button
                type="submit"
                variant="outlined"
                disabled={
                  !!busy ||
                  !password.current ||
                  password.next.length < 12 ||
                  password.confirm.length < 12
                }
                sx={{ alignSelf: "flex-start" }}
              >
                {busy === "password" ? "Changing…" : "Change password"}
              </Button>
            </Stack>
          </Card>
        </Stack>
      )}
    </>
  );
}
