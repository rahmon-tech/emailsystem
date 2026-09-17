import { Suspense } from "react";
import { Activity } from "../../../components/activity";
import { ActivityExperiment } from "../../../components/activity-experiment";
import { ActivityExperimentEvidence } from "../../../components/activity-experiment-evidence";
import { ActivityPacing } from "../../../components/activity-pacing";
import { ActivityProviderStatus } from "../../../components/activity-provider-status";
import { SavedCampaigns } from "../../../components/saved-campaigns";
import { Loading } from "../../../components/shared";
export const metadata = { title: "Activity" };
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SavedCampaigns />
      <ActivityPacing />
      <ActivityExperiment />
      <ActivityExperimentEvidence />
      <ActivityProviderStatus />
      <Activity />
    </Suspense>
  );
}
