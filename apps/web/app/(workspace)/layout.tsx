import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookie, userFromToken } from "@emailsystem/core/auth";
import { Shell } from "../../components/shell";
import { config } from "@emailsystem/core/config";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await userFromToken(
    (await cookies()).get(sessionCookie)?.value ?? "",
  );
  if (!user) redirect(config().APP_URL + "/login");
  return <Shell email={user.email}>{children}</Shell>;
}
