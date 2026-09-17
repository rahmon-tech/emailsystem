export type ActivityExperimentVariables = {
  pacingProfile: "smooth" | "bounded-burst";
  pacingIntervalMs?: number;
  pacingBurstSize?: number;
  concurrency?: number;
  transportEncoding: "provider-default" | "quoted-printable" | "base64";
  charset: "utf-8";
  contentMode:
    | "html"
    | "text"
    | "cid-inline"
    | "hosted-image"
    | "attachment-only"
    | "image-dominant";
};

const seconds = (milliseconds: number) => {
  const value = milliseconds / 1000;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}s`;
};

const words = (value: string) => value.replaceAll("-", " ");

export function experimentConfigurationLabels(
  variables: ActivityExperimentVariables,
) {
  const labels = [`Pacing: ${words(variables.pacingProfile)}`];
  if (variables.pacingIntervalMs !== undefined)
    labels.push(
      `${variables.pacingProfile === "bounded-burst" ? "Window" : "Interval"}: ${seconds(variables.pacingIntervalMs)}`,
    );
  if (variables.pacingBurstSize !== undefined)
    labels.push(`Burst: ${variables.pacingBurstSize.toLocaleString()}`);
  if (variables.concurrency !== undefined)
    labels.push(`Concurrency: ${variables.concurrency.toLocaleString()}`);
  labels.push(`Encoding: ${words(variables.transportEncoding)}`);
  labels.push(`Charset: ${variables.charset.toUpperCase()}`);
  labels.push(`Requested content: ${words(variables.contentMode)}`);
  return labels;
}
