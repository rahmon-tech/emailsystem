import { createHash } from "node:crypto";

export const E2E_EMAIL = "browser-test@example.com";
export const E2E_PASSWORD = createHash("sha256")
  .update("emailsystem-e2e-browser-fixture")
  .digest("base64url");
