"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Box,
  Card,
  Stack,
  Typography,
  TextField,
  Button,
  Alert,
  Avatar,
} from "@mui/material";
import { MailOutlined, ArrowForward } from "@mui/icons-material";
import { api } from "../../components/api-client";
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        p: 2,
        bgcolor: "background.default",
      }}
    >
      <Card sx={{ p: { xs: 3, sm: 4 }, width: "100%", maxWidth: 420 }}>
        <Stack
          spacing={3}
          component="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("auth/login", { email, password });
              router.replace("/providers");
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Avatar
              variant="rounded"
              sx={{ bgcolor: "primary.main", width: 30, height: 30 }}
            >
              <MailOutlined fontSize="small" />
            </Avatar>
            <Typography
              sx={{ fontSize: 16, fontWeight: 650, letterSpacing: "-.025em" }}
            >
              EmailSystem
            </Typography>
          </Stack>
          <Box>
            <Typography component="h1" variant="h4" sx={{ fontSize: 28 }}>
              Welcome back
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Your sending workspace, ready when you are.
            </Typography>
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Email address"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            type="submit"
            variant="contained"
            loading={busy}
            endIcon={<ArrowForward />}
            disabled={busy}
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <Typography sx={{ fontSize: 13 }} color="text.secondary">
            Need access? Contact your workspace administrator.
          </Typography>
        </Stack>
      </Card>
    </Box>
  );
}
