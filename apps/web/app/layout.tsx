import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { Theme } from "../components/theme";
import "./globals.css";
export const metadata = {
  title: { default: "EmailSystem", template: "%s · EmailSystem" },
  description:
    "Manage sending providers, prepare email campaigns, and follow delivery activity.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          <Theme>{children}</Theme>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
