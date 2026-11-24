import { recoverySettings } from "@emailsystem/core/account-recovery-config";
import { RecoveryForm } from "../../components/recovery-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recover access" };

export default function RecoveryPage() {
  return <RecoveryForm available={Boolean(recoverySettings())} />;
}
