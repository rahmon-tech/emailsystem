import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookie, userFromTokens } from "@emailsystem/core/auth";
import { Shell } from "../../components/shell";
import { absoluteAppUrl } from "@emailsystem/core/server-paths";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const store = await cookies();
  const resolved = await userFromTokens(
    store.getAll(sessionCookie).map((cookie) => cookie.value),
  );
  if (!resolved) redirect(absoluteAppUrl("/login"));
  return <Shell email={resolved.user.email}>{children}</Shell>;
}
