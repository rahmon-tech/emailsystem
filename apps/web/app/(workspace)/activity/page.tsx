import { Suspense } from "react";
import { Activity } from "../../../components/activity";
import { ActivityExperimentSummary } from "../../../components/activity-experiment-summary";
import { ActivityPacing } from "../../../components/activity-pacing";
import { SavedCampaigns } from "../../../components/saved-campaigns";
import { Loading } from "../../../components/shared";
export const metadata = { title: "Activity" };
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SavedCampaigns />
      <ActivityExperimentSummary />
      <ActivityPacing />
      <Activity />
    </Suspense>
  );
}
