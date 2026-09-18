import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookie, userFromTokens } from "@emailsystem/core/auth";
import { absoluteAppUrl } from "@emailsystem/core/server-paths";
import { LoginForm } from "../../components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const store = await cookies();
  const resolved = await userFromTokens(
    store.getAll(sessionCookie).map((cookie) => cookie.value),
  );
  if (resolved) redirect(absoluteAppUrl("/blast"));
  return <LoginForm />;
}
