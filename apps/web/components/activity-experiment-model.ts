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

const encodingLabel = (
  value: ActivityExperimentVariables["transportEncoding"],
) => (value === "provider-default" ? "Automatic" : value);

const messageTypeLabel = (
  value: ActivityExperimentVariables["contentMode"],
) =>
  ({
    html: "HTML email",
    text: "Plain text",
    "cid-inline": "Embedded image",
    "hosted-image": "Web-hosted image",
    "attachment-only": "Attachment only",
    "image-dominant": "Image-first",
  })[value];

export function experimentConfigurationLabels(
  variables: ActivityExperimentVariables,
) {
  const labels = [`Sending pattern: ${variables.pacingProfile === "bounded-burst" ? "small groups" : "steady"}`];
  if (variables.pacingIntervalMs !== undefined)
    labels.push(
      `${variables.pacingProfile === "bounded-burst" ? "Group window" : "Time between sends"}: ${seconds(variables.pacingIntervalMs)}`,
    );
  if (variables.pacingBurstSize !== undefined)
    labels.push(`Group size: ${variables.pacingBurstSize.toLocaleString()}`);
  if (variables.concurrency !== undefined)
    labels.push(`Emails at once: ${variables.concurrency.toLocaleString()}`);
  labels.push(`Email format: ${encodingLabel(variables.transportEncoding)}`);
  labels.push(`Character support: ${variables.charset.toUpperCase()}`);
  labels.push(`Message type: ${messageTypeLabel(variables.contentMode)}`);
  return labels;
}
