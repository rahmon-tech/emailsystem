import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@emailsystem/db";
import { sessionCookie, userFromTokens } from "@emailsystem/core/auth";
import { absoluteAppUrl } from "@emailsystem/core/server-paths";
import { ImageBlast } from "../../../../components/image-blast";

export const metadata = { title: "Image-first Blast" };
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
  return <ImageBlast />;
}
