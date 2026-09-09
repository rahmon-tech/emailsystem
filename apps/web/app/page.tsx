import { redirect } from "next/navigation";
import { absoluteAppUrl } from "@emailsystem/core/server-paths";
export const dynamic = "force-dynamic";
export default function Home() {
  redirect(absoluteAppUrl("/providers"));
}
