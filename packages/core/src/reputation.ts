import { domainToASCII } from "node:url";
import { db } from "@emailsystem/db";
import { destination, emailLinks } from "@emailsystem/email";

export type ReputationState =
  "REPUTATION_CLEAN" | "REPUTATION_BLOCKED" | "REPUTATION_UNKNOWN";
export type ReputationResult = { state: ReputationState; source: string };
export interface ReputationSource {
  id: string;
  // CLEAN means an affirmative assessment, never merely "not in this list".
  check(
    url: URL,
    context: { userId: string; signal: AbortSignal },
  ): Promise<ReputationState>;
}
export function canonicalDomain(input: string) {
  const host = domainToASCII(input.trim().toLowerCase().replace(/\.$/, ""));
  if (
    host.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
  )
    throw new Error("Enter a hostname, without a path or protocol.");
  return host;
}
export const isDeniedDomain = (hostname: string, denied: string[]) => {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return denied.some((d) => host === d || host.endsWith("." + d));
};

export async function checkReputation(
  url: URL,
  userId: string,
  sources: ReputationSource[],
  timeoutMs = 1500,
) {
  const results = await Promise.all(
    sources.map(async (source): Promise<ReputationResult> => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const state = await Promise.race([
          Promise.resolve().then(() =>
            source.check(url, { userId, signal: controller.signal }),
          ),
          new Promise<ReputationState>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve("REPUTATION_UNKNOWN");
            }, timeoutMs);
          }),
        ]);
        return {
          source: source.id,
          state: [
            "REPUTATION_CLEAN",
            "REPUTATION_BLOCKED",
            "REPUTATION_UNKNOWN",
          ].includes(state)
            ? state
            : "REPUTATION_UNKNOWN",
        };
      } catch {
        return { source: source.id, state: "REPUTATION_UNKNOWN" };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const state: ReputationState = results.some(
    (r) => r.state === "REPUTATION_BLOCKED",
  )
    ? "REPUTATION_BLOCKED"
    : results.length && results.every((r) => r.state === "REPUTATION_CLEAN")
      ? "REPUTATION_CLEAN"
      : "REPUTATION_UNKNOWN";
  return { state, results };
}

// Optional adapters are composed here by the deployment owner. No third-party
// API receives customer URLs unless that adapter has been explicitly installed.
export async function inspectDestinations(
  userId: string,
  html: string,
  optionalSources: ReputationSource[] = [],
) {
  const allLinks = emailLinks(html);
  const links = allLinks.filter((href) => /^https?:/i.test(href));
  if (links.length > 200)
    return {
      problems: ["Use at most 200 distinct web links per message."],
      warnings: [],
      links: [],
    };
  const denied = (
    await db.deniedDestination.findMany({
      where: { userId },
      select: { hostname: true },
    })
  ).map((d) => d.hostname);
  const local: ReputationSource = {
    id: "local-denied-domains",
    async check(url) {
      return isDeniedDomain(url.hostname, denied)
        ? "REPUTATION_BLOCKED"
        : "REPUTATION_UNKNOWN";
    },
  };
  const checked: { hostname: string; state: ReputationState }[] = [];
  const problems: string[] = allLinks.some(
    (href) => !/^(https?:\/\/|mailto:|tel:|#)/i.test(href),
  )
    ? [
        "Use absolute HTTP/HTTPS destinations for web links; relative links cannot work reliably in email.",
      ]
    : [];
  // Bounded concurrency and per-source deadlines prevent pre-flight fan-out.
  for (let index = 0; index < links.length; index += 8) {
    await Promise.all(
      links.slice(index, index + 8).map(async (href) => {
        const url = destination(href);
        if (!url) {
          problems.push(
            "A web link contains an invalid destination, embedded credentials, or ambiguous characters.",
          );
          return;
        }
        const localResult = await checkReputation(url, userId, [local]);
        // Absence from a deny-list is neutral, never a clean assessment.
        // An affirmative optional assessment can be clean; outages stay unknown.
        const result =
          localResult.state === "REPUTATION_BLOCKED"
            ? localResult
            : await checkReputation(url, userId, optionalSources);
        checked.push({ hostname: url.hostname, state: result.state });
        if (result.state === "REPUTATION_BLOCKED")
          problems.push(
            `A destination is blocked: ${url.hostname}. Update the link before sending.`,
          );
      }),
    );
  }
  return {
    links: checked,
    problems: [...new Set(problems)],
    warnings: checked.some((r) => r.state === "REPUTATION_UNKNOWN")
      ? [
          "Some link reputations are unknown. An unlisted destination is not proof of safety.",
        ]
      : [],
  };
}
