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
  const labels = [`Sending pattern: ${variables.pacingProfile === "bounded-burst" ? "small groups" : "steady"}`];
  if (variables.pacingIntervalMs !== undefined)
    labels.push(
      `${variables.pacingProfile === "bounded-burst" ? "Group window" : "Send interval"}: ${seconds(variables.pacingIntervalMs)}`,
    );
  if (variables.pacingBurstSize !== undefined)
    labels.push(`Group size: ${variables.pacingBurstSize.toLocaleString()}`);
  if (variables.concurrency !== undefined)
    labels.push(`Emails at once: ${variables.concurrency.toLocaleString()}`);
  labels.push(`Email encoding: ${words(variables.transportEncoding)}`);
  labels.push(`Text format: ${variables.charset.toUpperCase()}`);
  labels.push(`Message type: ${words(variables.contentMode).replace("cid inline", "embedded image")}`);
  return labels;
}
