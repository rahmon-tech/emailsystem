import { config } from "./config";
import { absoluteUrlFromRoot } from "./paths";

/** APP_URL already owns the configured application base path. */
export const absoluteAppUrl = (path: string) =>
  absoluteUrlFromRoot(config().APP_URL, path);
