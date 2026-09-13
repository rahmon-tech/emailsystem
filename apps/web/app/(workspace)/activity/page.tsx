import { Suspense } from "react";
import { Activity } from "../../../components/activity";
import { SavedCampaigns } from "../../../components/saved-campaigns";
import { Loading } from "../../../components/shared";
export const metadata = { title: "Activity" };
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SavedCampaigns />
      <Activity />
    </Suspense>
  );
}
