"use client";
import {useRouter} from "next/navigation";
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
import { MailOutlined } from "@mui/icons-material";
import { api } from "../../components/api-client";
export default function Login() {
 const router=useRouter();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        p: 3,
        background:
          "radial-gradient(ellipse at 20% 20%,#e6edff,transparent 60%),#f4f7fb",
      }}
    >
      <Card sx={{ p: { xs: 3, sm: 5 }, width: "100%", maxWidth: 440 }}>
        <Stack
          spacing={3}
          component="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("auth/login", { email, password });
              router.replace("/providers");router.refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Avatar
            variant="rounded"
            sx={{ bgcolor: "primary.main", width: 48, height: 48 }}
          >
            <MailOutlined />
          </Avatar>
          <Box>
            <Typography variant="h4">Welcome back</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Sign in to your EmailSystem workspace.
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
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <Typography sx={{ fontSize: 13 }} color="text.secondary">
            Need an account? Contact the person managing your EmailSystem
            server.
          </Typography>
        </Stack>
      </Card>
    </Box>
  );
}
