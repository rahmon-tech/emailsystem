"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Box,
  Typography,
  Button,
  Avatar,
  Menu,
  MenuItem,
  IconButton,
  Drawer,
  Stack,
} from "@mui/material";
import {
  HubOutlined,
  SendOutlined,
  TerminalOutlined,
  MenuRounded,
  ExpandMore,
  MailOutlined,
} from "@mui/icons-material";
import { api } from "./api-client";
const sections = [
  { label: "Providers", path: "/providers", icon: HubOutlined },
  { label: "Blast", path: "/blast", icon: SendOutlined },
  { label: "Activity", path: "/activity", icon: TerminalOutlined },
];
export function Shell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const router=useRouter();
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false),
    [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigation = (
    <Box
      sx={{ p: 3, height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Stack direction="row" spacing={1.3} sx={{ alignItems: "center", mb: 6 }}>
        <Avatar
          variant="rounded"
          sx={{ bgcolor: "primary.main", width: 36, height: 36 }}
        >
          <MailOutlined fontSize="small" />
        </Avatar>
        <Typography
          sx={{ fontWeight: 800, fontSize: 19, letterSpacing: "-.04em" }}
        >
          EmailSystem
        </Typography>
      </Stack>
      <Typography
        color="text.secondary"

        sx={{ fontSize: 12, fontWeight: 700, mb: 2, letterSpacing: 1 }}
      >
        WORKSPACE
      </Typography>
      <Stack spacing={1}>
        {sections.map((s) => (
          <Button
            component={Link}
            key={s.path}
            href={s.path}
            onClick={() => setMobile(false)}
            startIcon={<s.icon />}
            sx={{
              justifyContent: "flex-start",
              p: 1.5,
              color: pathname === s.path ? "primary.main" : "text.secondary",
              bgcolor: pathname === s.path ? "#eaf0ff" : "transparent",
            }}
          >
            {s.label}
          </Button>
        ))}
      </Stack>
      <Box sx={{ mt: "auto", pt: 6 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
          Your sending workspace
        </Typography>
        <Typography sx={{ fontSize: 13 }} color="text.secondary">
          Providers, messages, and delivery activity in one place.
        </Typography>
      </Box>
    </Box>
  );
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Box
        component="aside"
        sx={{
          width: 230,
          display: { xs: "none", md: "block" },
          position: "fixed",
          inset: "0 auto 0 0",
          bgcolor: "white",
        }}
      >
        {navigation}
      </Box>
      <Drawer
        open={mobile}
        onClose={() => setMobile(false)}
        sx={{ "& .MuiDrawer-paper": { width: 250 } }}
      >
        {navigation}
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0, ml: { md: "230px" } }}>
        <Box
          component="header"
          sx={{
            height: 76,
            px: { xs: 2, md: 5 },
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            bgcolor: "white",
            borderBottom: "1px solid #edf1f7",
          }}
        >
          <Stack sx={{ alignItems: "center" }} direction="row" spacing={1}>
            <IconButton
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
              sx={{ display: { md: "none" } }}
            >
              <MenuRounded />
            </IconButton>
            <Typography sx={{ fontSize: 14 }} color="text.secondary">
              Workspace{" "}
              <Box component="span" sx={{ mx: 1.5, color: "#c3cbd9" }}>
                /
              </Box>
              <Box
                component="span"
                sx={{ color: "text.primary", fontWeight: 600 }}
              >
                {sections.find((s) => s.path === pathname)?.label}
              </Box>
            </Typography>
          </Stack>
          <Button
            color="inherit"
            onClick={(e) => setAnchor(e.currentTarget)}
            endIcon={<ExpandMore />}
            sx={{ minWidth: 0 }}
          >
            <Avatar
              sx={{
                width: 32,
                height: 32,
                bgcolor: "#e9effb",
                color: "primary.main",
                mr: { sm: 1 },
                fontSize: 14,
              }}
            >
              {email.slice(0, 2).toUpperCase()}
            </Avatar>
            <Box
              component="span"
              sx={{
                display: { xs: "none", sm: "inline" },
                maxWidth: 180,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {email}
            </Box>
          </Button>
          <Menu
            anchorEl={anchor}
            open={!!anchor}
            onClose={() => setAnchor(null)}
          >
            <MenuItem disabled>{email}</MenuItem>
            <MenuItem
              onClick={async () => {
                await api("auth/logout", {});
                router.replace("/login");router.refresh();
              }}
            >
              Sign out
            </MenuItem>
          </Menu>
        </Box>
        <Box
          component="main"
          sx={{ p: { xs: 2, sm: 3, lg: 5 }, maxWidth: 1600, mx: "auto" }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
