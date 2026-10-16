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

const SIDEBAR_WIDTH = 232;

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
  const [mobile, setMobile] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const activeSection = sections.find(
    ({ path }) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const currentTitle = activeSection?.label ?? "Workspace";

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
      sx={{
        px: 2,
        pt: 2.5,
        pb: 2,
        height: "100%",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", px: 1, mb: 4 }}>
        <Avatar
          variant="rounded"
          sx={{
            bgcolor: "primary.main",
            width: 34,
            height: 34,
            borderRadius: "9px",
          }}
        >
          <MailOutlined fontSize="small" />
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 750, letterSpacing: "-.035em", lineHeight: 1.2 }}>
            EmailBlast
          </Typography>
          <Typography sx={{ fontSize: 11, color: "text.secondary", mt: 0.2 }}>
            Campaign workspace
          </Typography>
        </Box>
      </Stack>

      <Typography
        variant="caption"
        sx={{
          px: 1.5,
          pb: 1.25,
          color: "text.secondary",
          fontSize: 11,
          fontWeight: 650,
          letterSpacing: ".08em",
          textTransform: "uppercase",
        }}
      >
        Workspace
      </Typography>
      <Stack component="nav" aria-label="Main navigation" spacing={0.5}>
        {sections.map((section) => {
          const selected = activeSection?.path === section.path;
          return (
            <Button
              component={Link}
              key={section.path}
              href={section.path}
              onClick={() => setMobile(false)}
              startIcon={<section.icon sx={{ fontSize: 19 }} />}
              aria-current={selected ? "page" : undefined}
              sx={{
                minHeight: 43,
                justifyContent: "flex-start",
                px: 1.5,
                py: 1,
                borderRadius: "8px",
                color: selected ? "primary.main" : "text.secondary",
                bgcolor: selected ? "action.selected" : "transparent",
                fontWeight: selected ? 700 : 550,
                "&:hover": {
                  bgcolor: selected ? "action.selected" : "action.hover",
                },
                "& .MuiButton-startIcon": { mr: 1.15 },
              }}
            >
              {section.label}
            </Button>
          );
        })}
      </Stack>

      <Box sx={{ flex: 1 }} />
      <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2, px: 1 }}>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 0.5 }}>
          Signed in as
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
          <PersonOutlined sx={{ fontSize: 18, color: "text.secondary", flexShrink: 0 }} />
          <Typography variant="body2" noWrap title={email} sx={{ fontWeight: 550 }}>
            {email}
          </Typography>
        </Stack>
      </Box>
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
          width: SIDEBAR_WIDTH,
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
            width: 256,
            maxWidth: "calc(100vw - 24px)",
          },
        }}
      >
        {navigation}
      </Drawer>
      <Box
        sx={{
          width: { xs: "100%", md: `calc(100% - ${SIDEBAR_WIDTH}px)` },
          minWidth: 0,
          ml: { xs: 0, md: `${SIDEBAR_WIDTH}px` },
          overflowX: "clip",
        }}
      >
        <Box
          component="header"
          sx={{
            height: 64,
            width: "100%",
            minWidth: 0,
            px: { xs: 2, md: 3, lg: 4 },
            display: "flex",
            alignItems: "center",
            gap: 1,
            justifyContent: "space-between",
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
            position: "sticky",
            top: 0,
            zIndex: 1100,
          }}
        >
          <Stack sx={{ alignItems: "center", minWidth: 0, flex: 1 }} direction="row" spacing={1}>
            <IconButton
              aria-label="Open navigation"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
              sx={{ display: { md: "none" }, ml: -0.5 }}
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
            <Typography sx={{ fontSize: 13, fontWeight: 650 }} noWrap>
              {currentTitle}
            </Typography>
          </Stack>
          {activeSection?.path !== "/blast" && (
            <Button
              component={Link}
              href="/blast"
              variant="contained"
              size="small"
              startIcon={<SendOutlined sx={{ fontSize: 18 }} />}
              sx={{ display: { xs: "none", sm: "inline-flex" }, flexShrink: 0, minHeight: 36 }}
            >
              New campaign
            </Button>
          )}
          <Button
            aria-label="Account menu"
            color="inherit"
            onClick={(e) => setAnchor(e.currentTarget)}
            endIcon={<ExpandMore sx={{ fontSize: 18 }} />}
            sx={{ minWidth: 0, flexShrink: 0, pl: 0.75, pr: 0.25 }}
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
                maxWidth: 160,
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
              maxWidth: 1360,
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
