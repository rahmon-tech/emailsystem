import { Providers } from "../../../components/providers";
import { ProviderPacingPanel } from "../../../components/provider-pacing-panel";
export const metadata = { title: "Sending services" };
export default function Page() {
  return (
    <>
      <Providers />
      <ProviderPacingPanel />
    </>
  );
}
