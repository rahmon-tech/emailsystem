import { z } from "zod";
export const dailyBudget = z.number().int().min(1).max(10000000);
export const pacingPerMinute = z.number().int().min(1).max(1000000).nullable();
export const warmupProfile = z
  .enum(["conservative", "balanced", "high_capacity"])
  .default("balanced");
export type WarmupProfile = z.infer<typeof warmupProfile>;
export const safetySettings = z
  .object({
    accountDaily: dailyBudget.default(10000),
    domainDaily: dailyBudget.default(5000),
    providerDaily: dailyBudget.default(5000),
    campaignDaily: dailyBudget.nullable().default(5000),
    accountPerMinute: pacingPerMinute.default(null),
    domainPerMinute: pacingPerMinute.default(null),
    campaignPerMinute: pacingPerMinute.default(null),
    warmupProfile,
    complaintRate: z.number().min(0.01).max(1).default(0.1),
    hardBounceRate: z.number().min(0.1).max(10).default(2),
    minimumSample: z.number().int().min(100).max(100000).default(100),
    brakeScope: z.enum(["account", "campaign", "both"]).default("both"),
  })
  .strict();
export type SafetySettings = z.infer<typeof safetySettings>;
export function messageCost(message: {
  cc: readonly string[];
  bcc: readonly string[];
}) {
  return 1 + message.cc.length + message.bcc.length;
}
export function brakeDecision(
  settings: SafetySettings,
  outcomes: { sample: number; complaints: number; hardBounces: number },
) {
  if (outcomes.sample < settings.minimumSample) return null;
  if (outcomes.complaints * 100 >= settings.complaintRate * outcomes.sample)
    return "complaint";
  if (outcomes.hardBounces * 100 >= settings.hardBounceRate * outcomes.sample)
    return "hard_bounce";
  return null;
}