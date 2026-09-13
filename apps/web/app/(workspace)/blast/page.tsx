import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Box, Button } from "@mui/material";
import { ImageOutlined } from "@mui/icons-material";
import { db } from "@emailsystem/db";
import { sessionCookie, userFromTokens } from "@emailsystem/core/auth";
import { appPath } from "@emailsystem/core/paths";
import { absoluteAppUrl } from "@emailsystem/core/server-paths";
import { Blast } from "../../../components/blast";
import { SavedImports } from "../../../components/saved-imports";
export const metadata = { title: "Blast" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const store = await cookies();
  const resolved = await userFromTokens(
    store.getAll(sessionCookie).map((cookie) => cookie.value),
  );
  if (!resolved) redirect(absoluteAppUrl("/login"));
  const providers = await db.providerConnection.count({
    where: { userId: resolved.user.id, deletedAt: null },
  });
  if (!providers) redirect(absoluteAppUrl("/providers"));
  return (
    <>
      <SavedImports />
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1.5 }}>
        <Button
          href={appPath("/blast/image")}
          size="small"
          startIcon={<ImageOutlined />}
        >
          Image-first mode
        </Button>
      </Box>
      <Blast />
    </>
  );
}
