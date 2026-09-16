import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { verifyProvider } from "@emailsystem/core/providers";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { config } from "@emailsystem/core/config";
import { prepareCampaign } from "@emailsystem/core/campaigns";
import {
  processDelivery,
  recoverStalled,
  finishCampaigns,
} from "@emailsystem/core/engine";
import { reconcileEvents, ingestEvent } from "@emailsystem/core/events";
import { unclaimedStates } from "@emailsystem/core/domain";
import { log } from "@emailsystem/core/errors";
import { retainTracking } from "@emailsystem/core/tracking";
import { retainExperimentData } from "@emailsystem/core/experiment-retention";
import { refreshProviderAdaptation } from "@emailsystem/core/provider-adaptation";
const cfg = config();
const connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("email-deliveries", { connection });
const worker = new Worker(
  "email-deliveries",
  async (job) => {
    await processDelivery(String(job.data.deliveryId));
  },
  {
    connection,
    concurrency: cfg.WORKER_CONCURRENCY,
    lockDuration: 120000,
    maxStalledCount: 1,
  },
);
worker.on("failed", (job) =>
  log("worker.job.failed", { deliveryId: job?.data.deliveryId }),
);
worker.on("error", () => log("worker.error"));
let stopping = false;
let iteration = 0;
async function pump() {
  while (!stopping) {
    try {
      await db.campaign.updateMany({
        where: {
          state: { in: ["QUEUED", "SENDING"] },
          user: { providers: { some: { health: "POLICY_BLOCKED" } } },
        },
        data: {
          state: "PAUSED",
          safeError:
            "Provider enforcement reported. Review the blocked connection before resuming.",
        },
      });
      const preparing = await db.campaign.findMany({
        where: { state: { in: ["PREPARING", "CANCELLING"] }, preparedAt: null },
        select: { id: true },
        take: 10,
      });
      for (const c of preparing) await prepareCampaign(c.id);
      const jobs = await db.delivery.findMany({
        where: {
          state: { in: unclaimedStates },
          nextAttemptAt: { lte: new Date() },
          campaign: {
            state: { in: ["QUEUED", "SENDING"] },
            preparedAt: { not: null },
            safetyPausedReason: null,
            user: { safetyPausedReason: null },
            OR: [
              { safetyWaitUntil: null },
              { safetyWaitUntil: { lte: new Date() } },
            ],
          },
        },
        orderBy: { nextAttemptAt: "asc" },
        take: 250,
        select: { id: true },
      });
      if (jobs.length) {
        await queue.addBulk(
          jobs.map((j) => ({
            name: "deliver",
            data: { deliveryId: j.id },
            opts: {
              jobId: j.id,
              removeOnComplete: true,
              removeOnFail: true,
              attempts: 1,
            },
          })),
        );
        await db.delivery.updateMany({
          where: { id: { in: jobs.map((j) => j.id) }, state: "PENDING" },
          data: { state: "QUEUED" },
        });
      }
      await recoverStalled();
      await reconcileEvents();
      await finishCampaigns();
      await redis.set("worker:heartbeat", Date.now(), "EX", 30);
      if (iteration % 5 === 0) await refreshProviderAdaptation();
      if (cfg.ALLOW_MOCK_PROVIDER === "true") {
        const mock = await db.deliveryAttempt.findMany({
          where: {
            state: "ACCEPTED",
            provider: { type: "mock" },
            delivery: { state: "PROVIDER_ACCEPTED" },
          },
          include: { provider: true, delivery: true },
          take: 100,
        });
        for (const a of mock) {
          const mode = (a.provider.settings as { mockMode: string }).mockMode;
          await ingestEvent(a.providerId, {
            eventKey: "mock-" + a.id,
            messageId: a.providerMessageId!,
            attemptId: a.id,
            recipient: a.delivery.email,
            kind: mode === "bounce" ? "hard_bounce" : "delivered",
            occurredAt: new Date(),
          });
        }
      }
      {
        const providers = await db.providerConnection.findMany({
          where: {
            type: "ses",
            transport: "api",
            deletedAt: null,
            health: { in: ["HEALTHY", "THROTTLED"] },
            verifiedAt: { lt: new Date(Date.now() - 300000) },
          },
          take: 1,
          orderBy: { verifiedAt: "asc" },
        });
        for (const p of providers) await verifyProvider(p.userId, p.id);
      }
      if (iteration++ % 1800 === 0) {
        await retainTracking();
        await retainExperimentData(new Date(), {
          evidenceDays: cfg.EXPERIMENT_EVIDENCE_RETENTION_DAYS,
          messageDays: cfg.EXPERIMENT_MESSAGE_RETENTION_DAYS,
        });
        const date = new Date(
          Date.now() - cfg.ACTIVITY_RETENTION_DAYS * 86400000,
        );
        await db.activityEvent.deleteMany({
          where: { createdAt: { lt: date } },
        });
        await db.providerEvent.deleteMany({
          where: {
            createdAt: {
              lt: new Date(Date.now() - cfg.WEBHOOK_RETENTION_DAYS * 86400000),
            },
          },
        });
        await db.session.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
        await db.deliveryAttempt.deleteMany({
          where: {
            state: "REJECTED",
            providerMessageId: null,
            startedAt: {
              lt: new Date(Date.now() - cfg.ATTEMPT_RETENTION_DAYS * 86400000),
            },
            delivery: {
              state: { notIn: ["PROCESSING", "UNKNOWN", "DEFERRED"] },
            },
          },
        });
      }
    } catch {
      log("worker.pump.failed");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const running = pump();
async function stop() {
  if (stopping) return;
  stopping = true;
  await running;
  await worker.close();
  await queue.close();
  await connection.quit();
  await redis.quit();
  await db.$disconnect();
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
