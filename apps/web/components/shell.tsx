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
  LogoutOutlined,
  ChevronRight,
  PersonOutlined,
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
  const router = useRouter();
  const pathname = usePathname();
  const [mobile, setMobile] = useState(false),
    [anchor, setAnchor] = useState<HTMLElement | null>(null);
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
      <Stack spacing={0.5}>
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
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
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
        sx={{ "& .MuiDrawer-paper": { width: 250 } }}
      >
        {navigation}
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0, ml: { md: "208px" } }}>
        <Box
          component="header"
          sx={{
            height: 64,
            px: { xs: 2, md: 4 },
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
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
            sx={{ minWidth: 0 }}
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
          sx={{ p: { xs: 2, sm: 3, lg: 4 }, maxWidth: 1480, mx: "auto" }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
