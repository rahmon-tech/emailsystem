"use client";
import { useEffect, useState } from "react";
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
  LogoutOutlined,
  ChevronRight,
  PersonOutlined,
} from "@mui/icons-material";
import { api } from "./api-client";
const sections = [
  { label: "Create campaign", path: "/blast", icon: SendOutlined },
  { label: "Sending services", path: "/providers", icon: HubOutlined },
  { label: "Activity", path: "/activity", icon: TerminalOutlined },
];
export function Shell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false),
    [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const refresh = () => {
      void api("session/refresh").catch(() => {
        /* The API client redirects only when the session is actually invalid. */
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 12 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  const navigation = (
    <Box
      sx={{ p: 2.5, height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Stack direction="row" spacing={1.3} sx={{ alignItems: "center", mb: 5 }}>
        <Avatar
          variant="rounded"
          sx={{ bgcolor: "primary.main", width: 30, height: 30 }}
        >
          <MailOutlined fontSize="small" />
        </Avatar>
        <Typography
          sx={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.04em" }}
        >
          EmailSystem
        </Typography>
      </Stack>
      <Stack component="nav" aria-label="Main navigation" spacing={0.5}>
        {sections.map((s) => (
          <Button
            component={Link}
            key={s.path}
            href={s.path}
            onClick={() => setMobile(false)}
            startIcon={<s.icon />}
            aria-current={pathname === s.path ? "page" : undefined}
            sx={{
              justifyContent: "flex-start",
              px: 1.5,
              py: 1.2,
              color: pathname === s.path ? "primary.main" : "text.secondary",
              bgcolor: pathname === s.path ? "action.selected" : "transparent",
            }}
          >
            {s.label}
          </Button>
        ))}
      </Stack>
      <Stack
        direction="row"
        sx={{
          mt: "auto",
          pt: 3,
          gap: 1,
          alignItems: "center",
          color: "text.secondary",
        }}
      >
        <PersonOutlined fontSize="small" />
        <Typography variant="caption" noWrap title={email}>
          {email}
        </Typography>
      </Stack>
    </Box>
  );
  return (
    <Box
      sx={{
        minHeight: "100dvh",
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        overflowX: "clip",
      }}
    >
      <Box
        component="aside"
        sx={{
          width: 208,
          display: { xs: "none", md: "block" },
          position: "fixed",
          inset: "0 auto 0 0",
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        {navigation}
      </Box>
      <Drawer
        open={mobile}
        onClose={() => setMobile(false)}
        sx={{
          "& .MuiDrawer-paper": {
            width: 250,
            maxWidth: "calc(100vw - 24px)",
          },
        }}
      >
        {navigation}
      </Drawer>
      <Box
        sx={{
          width: { xs: "100%", md: "calc(100% - 208px)" },
          minWidth: 0,
          ml: { xs: 0, md: "208px" },
          overflowX: "clip",
        }}
      >
        <Box
          component="header"
          sx={{
            height: 64,
            width: "100%",
            minWidth: 0,
            px: { xs: 2, md: 4 },
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
            position: { xs: "sticky", md: "static" },
            top: { xs: 0, md: "auto" },
            zIndex: { xs: 1100, md: "auto" },
          }}
        >
          <Stack sx={{ alignItems: "center", minWidth: 0 }} direction="row" spacing={1}>
            <IconButton
              aria-label="Open navigation"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
              sx={{ display: { md: "none" } }}
            >
              <MenuRounded />
            </IconButton>
            <Typography
              sx={{ display: { xs: "none", sm: "block" }, fontSize: 13 }}
              color="text.secondary"
            >
              Workspace
            </Typography>
            <ChevronRight
              sx={{
                display: { xs: "none", sm: "block" },
                fontSize: 15,
                color: "text.secondary",
              }}
            />
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              {sections.find((s) => s.path === pathname)?.label}
            </Typography>
          </Stack>
          <Button
            aria-label="Account menu"
            color="inherit"
            onClick={(e) => setAnchor(e.currentTarget)}
            endIcon={<ExpandMore />}
            sx={{ minWidth: 0, flexShrink: 0 }}
          >
            <Avatar
              sx={{
                width: 32,
                height: 32,
                bgcolor: "action.selected",
                color: "primary.main",
                mr: { sm: 1 },
                fontSize: 14,
              }}
            >
              <PersonOutlined fontSize="small" />
            </Avatar>
            <Box
              component="span"
              sx={{
                display: { xs: "none", sm: "block" },
                whiteSpace: "nowrap",
                fontSize: 13,
                textAlign: "left",
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
                router.replace("/login");
                router.refresh();
              }}
            >
              <LogoutOutlined fontSize="small" sx={{ mr: 1 }} />
              Sign out
            </MenuItem>
          </Menu>
        </Box>
        <Box
          component="main"
          sx={{
            width: "100%",
            minWidth: 0,
            px: { xs: 2, sm: 3, lg: 4 },
            py: { xs: 2, sm: 3, lg: 4 },
            overflowX: "clip",
          }}
        >
          <Box
            sx={{
              width: "100%",
              minWidth: 0,
              maxWidth: 1480,
              mx: "auto",
              "& > *": { minWidth: 0, maxWidth: "100%" },
              "& .MuiCard-root": { minWidth: 0, maxWidth: "100%" },
              "& .MuiFormControl-root": { minWidth: 0, maxWidth: "100%" },
              "& .MuiInputBase-root": { minWidth: 0, maxWidth: "100%" },
              "& .MuiSelect-select": {
                minWidth: "0 !important",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            }}
          >
            {children}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
