import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@emailsystem/db";
import { sessionCookie, userFromToken } from "@emailsystem/core/auth";
import { absoluteAppUrl } from "@emailsystem/core/server-paths";
import { Blast } from "../../../components/blast";
import { SavedImports } from "../../../components/saved-imports";
export const metadata = { title: "Blast" };
export const dynamic = "force-dynamic";
export default async function Page() {
  const user = await userFromToken(
    (await cookies()).get(sessionCookie)?.value ?? "",
  );
  if (!user) redirect(absoluteAppUrl("/login"));
  const providers = await db.providerConnection.count({
    where: { userId: user.id, deletedAt: null },
  });
  if (!providers) redirect(absoluteAppUrl("/providers"));
  return (
    <>
      <SavedImports />
      <Blast />
    </>
  );
}
