// Emit only bounded screenshots of synthetic E2E fixtures. This text transport
// lets reviewers inspect images when the artifact download client is unavailable.
// Full PNGs, JPEGs and traces remain in the normal browser-verification artifact.
import { readdirSync, readFileSync, existsSync } from "node:fs";
const directory = "test-results/ux-review";
if (existsSync(directory)) {
  for (const name of readdirSync(directory).sort()) {
    if (
      name !== "failure.jpg" &&
      !/^(providers|provider-picker|provider-dialog|blast|preview|activity|login|tracking|fidelity-(?:newsletter|announcement)-(?:original|normalized))-(390|1366)\.jpg$/.test(
        name,
      )
    )
      continue;
    const bytes = readFileSync(`${directory}/${name}`);
    if (bytes.length > 500_000)
      throw new Error(`Review screenshot exceeds bound: ${name}`);
    const encoded = bytes.toString("base64");
    for (let offset = 0; offset < encoded.length; offset += 8192) {
      console.log(
        `UX_REVIEW ${name} ${offset} ${encoded.slice(offset, offset + 8192)}`,
      );
    }
  }
}
