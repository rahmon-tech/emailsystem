"use client";
import { ThemeProvider, createTheme, CssBaseline } from "@mui/material";
const theme = createTheme({
  palette: {
    primary: { main: "#2457e0" },
    background: { default: "#f4f7fb", paper: "#ffffff" },
    text: { primary: "#17243b", secondary: "#65748b" },
    success: { main: "#18764c" },
    error: { main: "#c13745" },
  },
  typography: {
    fontFamily:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 14,
    h4: { fontWeight: 750, letterSpacing: "-.04em" },
    h5: { fontWeight: 700, letterSpacing: "-.02em" },
    h6: { fontWeight: 650 },
    button: { textTransform: "none", fontWeight: 650 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 42 } },
    },
    MuiTextField: { defaultProps: { size: "small", fullWidth: true } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiCard: {
      styleOverrides: { root: { boxShadow: "0 3px 18px #132f5a06" } },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
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
