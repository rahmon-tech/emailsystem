export type ExperimentRetentionPolicy = {
  evidenceDays?: number;
  messageDays?: number;
};

export async function retainExperimentData(
  _now = new Date(),
  _policy: ExperimentRetentionPolicy = {},
) {
  throw new Error("Experiment retention is not implemented.");
}
