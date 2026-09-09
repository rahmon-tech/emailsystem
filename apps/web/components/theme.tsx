"use client";
import { alpha, ThemeProvider, createTheme, CssBaseline } from "@mui/material";
const theme = createTheme({
  palette: {
    primary: { main: "#465acb", dark: "#3446a5" },
    background: { default: "#f7f8fa", paper: "#ffffff" },
    text: { primary: "#202633", secondary: "#697181" },
    divider: "#e8ebf0",
    success: { main: "#23795b" },
    warning: { main: "#a56a17" },
    error: { main: "#bd4350" },
    info: { main: "#486b99" },
    action: { hover: "#f3f5f9", selected: "#edf0fb", focus: "#e5e9f8" },
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 14,
    h4: {
      fontSize: 30,
      fontWeight: 700,
      letterSpacing: "-.035em",
      lineHeight: 1.25,
    },
    h5: { fontSize: 22, fontWeight: 650, letterSpacing: "-.025em" },
    h6: { fontSize: 18, fontWeight: 650, letterSpacing: "-.02em" },
    body1: { fontSize: 14, lineHeight: 1.6 },
    body2: { fontSize: 13, lineHeight: 1.5 },
    caption: { fontSize: 12, lineHeight: 1.5 },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 42, borderRadius: 8, paddingInline: 16 },
        outlined: ({ theme }) => ({
          borderColor: theme.palette.divider,
          color: theme.palette.text.primary,
          backgroundColor: theme.palette.background.paper,
        }),
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { width: 42, height: 42, borderRadius: 8 } },
    },
    MuiTextField: { defaultProps: { size: "small", fullWidth: true } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 8,
          backgroundColor: theme.palette.background.paper,
          minHeight: 44,
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: theme.palette.divider,
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: theme.palette.text.secondary,
          },
        }),
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: 14 } } },
    MuiFormHelperText: {
      styleOverrides: { root: { marginLeft: 0, fontSize: 12 } },
    },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiCard: {
      styleOverrides: {
        root: ({ theme }) => ({
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: "0 2px 4px rgb(22 31 49 / 2%)",
          overflow: "hidden",
        }),
      },
    },
    MuiAccordion: {
      defaultProps: { disableGutters: true },
      styleOverrides: {
        root: {
          backgroundImage: "none",
          boxShadow: "none",
          "&:before": { display: "none" },
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: { minHeight: 44, padding: 0 },
        content: { marginBlock: 10, fontSize: 13, fontWeight: 600 },
      },
    },
    MuiAccordionDetails: {
      styleOverrides: { root: { padding: "8px 0 16px" } },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: 3,
          borderRadius: 9,
          backgroundColor: theme.palette.action.hover,
          gap: 2,
        }),
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          minHeight: 40,
          border: "0 !important",
          borderRadius: "6px !important",
          padding: "6px 12px",
          color: theme.palette.text.secondary,
          "&.Mui-selected": {
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.primary.main,
            boxShadow: "0 1px 3px rgb(22 31 49 / 8%)",
          },
        }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 14,
          boxShadow: "0 24px 80px rgb(20 28 46 / 16%)",
          backgroundImage: "none",
        },
        paperFullScreen: { borderRadius: 0 },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: ({ theme }) => ({
          fontSize: 18,
          fontWeight: 650,
          padding: "16px 24px",
          borderBottom: `1px solid ${theme.palette.divider}`,
          flexShrink: 0,
        }),
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: "24px",
          overscrollBehavior: "contain",
          "&.MuiDialogContent-root": { paddingTop: 24 },
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: "16px 24px",
          gap: 8,
          borderTop: `1px solid ${theme.palette.divider}`,
          backgroundColor: theme.palette.background.paper,
          flexShrink: 0,
          "& > :not(style) ~ :not(style)": { marginLeft: 0 },
          [theme.breakpoints.down("sm")]: {
            padding: "12px 16px max(16px, env(safe-area-inset-bottom))",
            flexWrap: "wrap",
            "& > .MuiButton-root": { flex: 1, minHeight: 44 },
          },
        }),
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: ({ theme }) => ({
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: "0 8px 32px rgb(20 28 46 / 10%)",
          minWidth: 180,
        }),
      },
    },
    MuiMenuItem: { styleOverrides: { root: { minHeight: 44, fontSize: 14 } } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontSize: 12,
          fontWeight: 500,
          padding: "6px 10px",
          borderRadius: 6,
        },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 500, fontSize: 12 } } },
    MuiTabs: {
      styleOverrides: { root: { minHeight: 48 }, indicator: { height: 2 } },
    },
    MuiTab: {
      styleOverrides: {
        root: { minHeight: 48, paddingInline: 16, fontSize: 13 },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 5, borderRadius: 4 } },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8, fontSize: 13 },
        message: { minWidth: 0 },
      },
    },
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        ":root": {
          "--editor-border": theme.palette.divider,
          "--editor-link": theme.palette.primary.main,
          "--selection": alpha(theme.palette.primary.main, 0.16),
        },
        ":focus-visible": {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 3,
        },
        ".MuiButtonBase-root.Mui-focusVisible": {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.01ms !important",
            scrollBehavior: "auto !important",
          },
        },
      }),
    },
  },
});
export function Theme({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
