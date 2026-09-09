import { redirect } from "next/navigation";
import { config } from "@emailsystem/core/config";
export const dynamic = "force-dynamic";
export default function Home() {
  redirect(config().APP_URL + "/providers");
}
