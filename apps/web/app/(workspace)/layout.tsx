import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookie, userFromTokens } from "@emailsystem/core/auth";
import { Shell } from "../../components/shell";
import { absoluteAppUrl } from "@emailsystem/core/server-paths";
import { getWorkspaceSettings } from "@emailsystem/core/workspace-settings";
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
  const workspace = await getWorkspaceSettings(resolved.user.id);
  return (
    <Shell
      email={resolved.user.email}
      workspaceName={workspace.organizationName}
    >
      {children}
    </Shell>
  );
}
