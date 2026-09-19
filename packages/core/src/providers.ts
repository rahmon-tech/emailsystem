import {
  lockSafety,
  ensureGovernor,
  commonBudgets,
  senderDomain,
  providerMonthlyUsage,
} from "./safety";
import { safetySettings } from "./safety-config";
import { randomUUID } from "node:crypto";
import { db } from "@emailsystem/db";
import type { Prisma } from "@emailsystem/db";
import {
  connectionSchema,
  verifyConnection,
  send,
  supportsTestMode,
  definition,
} from "@emailsystem/providers";
import { supportsInlineAttachmentTransport } from "@emailsystem/providers/capabilities";
import type {
  Connection,
  ConnectionInput,
  Verification,
  ProviderMessage,
  Dependencies,
} from "@emailsystem/providers";
import { config } from "./config";
import { encryptSecret, decryptSecret } from "./security";
import type { SealedSecret } from "./security";
import { AppError } from "./errors";
import {
  ensureProviderIdentity,
  recordControlledSenderTest,
  senderForProviderTest,
  syncProviderAuthorization,
} from "./senders";
export const providerSelect = {
  id: true,
  name: true,
  bootstrapKey: true,
  type: true,
  transport: true,
  settings: true,
  credentialHint: true,
  enabled: true,
  health: true,
  verifiedAt: true,
  cooldownUntil: true,
  quotaRemaining: true,
  quotaCheckedAt: true,
  weight: true,
  perSecond: true,
  perMinute: true,
  concurrency: true,
  dailyBudgetOverride: true,
  monthlyBudgetOverride: true,
  revision: true,
  createdAt: true,
  domainAuthorizations: {
    select: {
      status: true,
      scope: true,
      safeDetail: true,
      authorizedDomain: { select: { id: true, domain: true, status: true } },
    },
  },
  verifications: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { status: true, checks: true, createdAt: true },
  },
};
export const json = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export function unlocked(row: {
  id: string;
  userId: string;
  name: string;
  type: string;
  transport: string;
  settings: unknown;
  credentials: unknown;
  weight: number;
  perSecond: number;
  perMinute: number;
  concurrency: number;
  dailyBudgetOverride: number | null;
  monthlyBudgetOverride: number | null;
}): Connection {
  return {
    ...connectionSchema.parse({
      name: row.name,
      type: row.type,
      transport: row.transport,
      settings: row.settings,
      credentials: decryptSecret(
        row.credentials as SealedSecret,
        config().CREDENTIAL_ENCRYPTION_KEY,
        `${row.userId}:${row.id}`,
      ),
      weight: row.weight,
      perSecond: row.perSecond,
      perMinute: row.perMinute,
      concurrency: row.concurrency,
      dailyBudget: row.dailyBudgetOverride ?? undefined,
      monthlyBudget: row.monthlyBudgetOverride ?? undefined,
    }),
    id: row.id,
  };
}
export async function getConnection(userId: string, id: string) {
  const row = await db.providerConnection.findFirst({
    where: { id, userId, deletedAt: null },
  });
  if (!row) throw new AppError(404, "NOT_FOUND", "Sending service not found.");
  return row;
}
export async function saveProvider(
  userId: string,
  input: unknown,
  id?: string,
  dependencies: Dependencies = {},
  createId?: string,
) {
  const previous = id ? await getConnection(userId, id) : null;
  let candidate = input;
  if (
    previous &&
    input &&
    typeof input === "object" &&
    !Array.isArray(input)
  ) {
    const record = input as Record<string, unknown>;
    const supplied =
      record.credentials &&
      typeof record.credentials === "object" &&
      !Array.isArray(record.credentials)
        ? (record.credentials as Record<string, unknown>)
        : {};
    const existing = unlocked(previous).credentials;
    const credentials: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(supplied)) {
      if (
        typeof value === "string" &&
        value.trim() === "" &&
        existing[key]
      )
        continue;
      credentials[key] = value;
    }
    candidate = { ...record, credentials };
  }
  const parsed = connectionSchema.parse(candidate);
  if (parsed.type === "mock" && config().ALLOW_MOCK_PROVIDER !== "true")
    throw new AppError(
      403,
      "MOCK_DISABLED",
      "The development-only sending service is disabled.",
    );
  const providerId = id ?? createId ?? randomUUID();
  if (!previous && createId) {
    const collision = await db.providerConnection.findUnique({
      where: { id: providerId },
      select: { id: true },
    });
    if (collision)
      throw new AppError(
        409,
        "PROVIDER_ID",
        "This connection setup is no longer available. Close it and add the sending service again.",
      );
  }
  if (
    previous &&
    (previous.type !== parsed.type || previous.transport !== parsed.transport)
  )
    throw new AppError(
      422,
      "TYPE",
      "Create a new connection to change the sending service or connection method.",
    );
  const credentials = { ...parsed.credentials };
  const hasSecret = Object.values(credentials).some(Boolean);
  const data = {
    name: parsed.name,
    type: parsed.type,
    transport: parsed.transport,
    settings: json(parsed.settings),
    credentials: json(
      encryptSecret(
        credentials,
        config().CREDENTIAL_ENCRYPTION_KEY,
        `${userId}:${providerId}`,
      ),
    ),
    credentialHint: hasSecret ? "Configured" : "No credentials",
    weight: parsed.weight,
    perSecond: parsed.perSecond,
    perMinute: parsed.perMinute,
    concurrency: parsed.concurrency,
    dailyBudgetOverride: parsed.dailyBudget,
    monthlyBudgetOverride: parsed.monthlyBudget,
    health: "TESTING",
    enabled: false,
    verifiedAt: null,
  };
  await db.$transaction(async (tx) => {
    if (previous) {
      const changed = await tx.providerConnection.updateMany({
        where: { id: providerId, userId, revision: previous.revision },
        data: { ...data, revision: { increment: 1 } },
      });
      if (!changed.count)
        throw new AppError(
          409,
          "STALE",
          "This connection changed. Reload the page before saving again.",
        );
    } else
      await tx.providerConnection.create({
        data: { id: providerId, userId, ...data },
      });
    await ensureProviderIdentity(tx, userId, providerId, parsed.settings);
    await tx.auditEvent.create({
      data: {
        userId,
        action: previous ? "provider.updated" : "provider.created",
        resourceId: providerId,
      },
    });
  });
  await verifyProvider(userId, providerId, dependencies);
  return db.providerConnection.findFirst({
    where: { id: providerId, userId },
    select: providerSelect,
  });
}

export async function upsertBootstrapProvider(
  userId: string,
  bootstrapKey: string,
  input: unknown,
) {
  const parsed = connectionSchema.parse(input);
  if (!/^[a-z0-9-]{1,40}$/.test(bootstrapKey))
    throw new AppError(422, "BOOTSTRAP_KEY", "Invalid bootstrap key.");
  if (parsed.type === "mock")
    throw new AppError(
      422,
      "BOOTSTRAP_PROVIDER",
      "Development-only sending services cannot be used for production setup.",
    );
  const previous = await db.providerConnection.findUnique({
    where: { userId_bootstrapKey: { userId, bootstrapKey } },
  });
  const providerId = previous?.id ?? randomUUID();
  const credentials = parsed.credentials;
  const hasSecret = Object.values(credentials).some(Boolean);
  const data = {
    bootstrapKey,
    name: parsed.name,
    type: parsed.type,
    transport: parsed.transport,
    settings: json(parsed.settings),
    credentials: json(
      encryptSecret(
        credentials,
        config().CREDENTIAL_ENCRYPTION_KEY,
        `${userId}:${providerId}`,
      ),
    ),
    credentialHint: hasSecret ? "Configured" : "No credentials",
    weight: parsed.weight,
    perSecond: parsed.perSecond,
    perMinute: parsed.perMinute,
    concurrency: parsed.concurrency,
    dailyBudgetOverride: parsed.dailyBudget,
    monthlyBudgetOverride: parsed.monthlyBudget,
    enabled: false,
    health: "UNVERIFIED",
    verifiedAt: null,
    cooldownUntil: null,
  };
  await db.$transaction(async (tx) => {
    if (previous)
      await tx.providerConnection.update({
        where: { id: providerId },
        data: { ...data, deletedAt: null, revision: { increment: 1 } },
      });
    else
      await tx.providerConnection.create({
        data: { id: providerId, userId, ...data },
      });
    await ensureProviderIdentity(tx, userId, providerId, parsed.settings);
    await tx.auditEvent.create({
      data: {
        userId,
        action: previous
          ? "provider.bootstrap.updated"
          : "provider.bootstrap.created",
        resourceId: providerId,
      },
    });
  });
  return db.providerConnection.findFirst({
    where: { id: providerId, userId },
    select: providerSelect,
  });
}
export async function verifyProvider(
  userId: string,
  id: string,
  dependencies: Dependencies = {},
) {
  const row = await getConnection(userId, id);
  const verification = await verifyConnection(unlocked(row), dependencies);
  await saveVerification(userId, id, row.revision, verification);
  return verification;
}
async function saveVerification(
  userId: string,
  id: string,
  revision: number,
  v: Verification,
) {
  await db.$transaction(async (tx) => {
    const current = await tx.providerConnection.findFirst({
      where: { id, userId },
    });
    const changed = await tx.providerConnection.updateMany({
      where: { id, userId, revision, deletedAt: null },
      data: {
        health: v.status,
        enabled: v.usable,
        verifiedAt: new Date(),
        cooldownUntil: null,
        ...(v.quotaRemaining !== undefined
          ? { quotaRemaining: v.quotaRemaining, quotaCheckedAt: new Date() }
          : {}),
        ...(v.maxSendRate
          ? {
              perSecond: Math.max(
                1,
                Math.min(v.maxSendRate, current?.perSecond ?? 1),
              ),
            }
          : {}),
      },
    });
    if (!changed.count)
      throw new AppError(
        409,
        "STALE",
        "This connection changed while it was being checked. Run the connection check again.",
      );
    await tx.providerVerification.create({
      data: { providerId: id, status: v.status, checks: json(v.checks) },
    });
    await tx.auditEvent.create({
      data: { userId, action: "provider.verified", resourceId: id },
    });
    await syncProviderAuthorization(tx, userId, id, v);
    // A provider verification/configuration change can add capacity or restore
    // an eligible route. Wake waiting campaigns so they re-evaluate the saved
    // provider limits immediately instead of sleeping until an obsolete timer.
    await tx.campaign.updateMany({
      where: { userId, safetyWaitUntil: { not: null } },
      data: { safetyWaitUntil: null, safetyWaitReason: null },
    });
  });
}
export async function testProvider(
  userId: string,
  id: string,
  recipient: string,
  testMode = false,
  message?: ProviderMessage,
  dependencies: Dependencies = {},
  senderSelection?: { senderIdentityId?: string; from?: string },
) {
  const row = await getConnection(userId, id),
    c = unlocked(row);
  if (
    message?.attachments.some(
      (attachment) => attachment.disposition === "inline",
    ) &&
    !supportsInlineAttachmentTransport(c)
  )
    throw new AppError(
      422,
      "INLINE_TRANSPORT",
      "This sending service cannot send messages with an embedded image.",
    );
  const selected = await senderForProviderTest(
    userId,
    id,
    senderSelection ?? { from: message?.from ?? c.settings.fromEmail },
  );
  if (testMode && !supportsTestMode(c))
    throw new AppError(
      422,
      "TEST_MODE",
      "This connection does not support a non-delivery test.",
    );
  if (
    await db.suppression.count({
      where: { userId, email: recipient.toLowerCase() },
    })
  )
    throw new AppError(422, "SUPPRESSED", "This test recipient is on the do-not-send list.");
  const test = await db.$transaction(
    async (tx) => {
      await lockSafety(tx, userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.safetyPausedReason)
        throw new AppError(409, "SAFETY_REVIEW", user.safetyPausedReason);
      const settings = safetySettings.parse(user.safetySettings),
        token = crypto.randomUUID();
      const governor = await ensureGovernor(tx, userId);
      const domain = senderDomain(selected.sender.email);
      const current = await tx.providerConnection.findFirstOrThrow({
        where: { id, userId },
      });
      if (current.monthlyBudgetOverride !== null) {
        const monthly = await providerMonthlyUsage(tx, userId, [id]);
        if ((monthly.get(id) ?? 0) + 1 > current.monthlyBudgetOverride)
          throw new AppError(
            429,
            "SAFETY_BUDGET",
            "This sending service has reached its monthly limit. Try again when the next month begins (UTC).",
          );
      }
      const reservation = await governor.reserve(
        token,
        [
          ...commonBudgets(settings, domain),
          {
            scope: "provider:" + id,
            limit: current.dailyBudgetOverride ?? settings.providerDaily,
          },
        ],
        1,
      );
      if (!reservation.allowed)
        throw new AppError(
          429,
          "SAFETY_BUDGET",
          "The 24-hour sending limit has been reached. Try again when capacity becomes available.",
        );
      if (!(await governor.commit(token)))
        throw new AppError(
          409,
          "SAFETY_BUDGET",
          "The test could not start in time. Try again.",
        );
      return tx.providerTestDelivery.create({
        data: {
          id: token,
          providerId: id,
          recipient,
          status: "PROCESSING",
          testMode,
          safetyAt: new Date(),
          senderDomain: domain,
        },
      });
    },
    { timeout: 60000 },
  );
  const m: ProviderMessage = message ?? {
    from: selected.sender.email,
    fromName: selected.sender.displayName,
    to: recipient,
    cc: [],
    bcc: [],
    replyTo: selected.sender.replyTo,
    subject: "EmailSystem test email",
    html: "<p>Your EmailSystem connection accepted this test.</p>",
    text: "Your EmailSystem connection accepted this test.",
    headers: {},
    attachments: [],
  };
  const result = await send(
    c,
    {
      ...m,
      from: selected.sender.email,
      fromName: selected.sender.displayName || m.fromName,
      replyTo: selected.sender.replyTo || m.replyTo,
      to: recipient,
      cc: [],
      bcc: [],
    },
    { attemptId: test.id, idempotencyKey: test.id, testMode },
    dependencies,
  );
  await db.providerTestDelivery.update({
    where: { id: test.id },
    data: {
      status: result.status,
      providerMessageId:
        result.status === "accepted" ? result.providerMessageId : undefined,
      safeError:
        result.status === "accepted" ? undefined : result.error.message,
    },
  });
  if (
    result.status === "accepted" &&
    !(
      testMode && definition(c.type).capabilities.nativeTestMode === "format"
    ) &&
    c.settings.messageStreamType !== "transactional" &&
    !["SANDBOX", "THROTTLED", "POLICY_BLOCKED"].includes(row.health) &&
    !(c.type === "postmark" && row.health === "CONFIG_ERROR")
  )
    await saveVerification(userId, id, row.revision, {
      status: "HEALTHY",
      usable: true,
      checks: [
        {
          name: "Send permission",
          status: "passed",
          detail: testMode
            ? "Non-delivery provider test accepted."
            : "Provider accepted the test email. Delivery is not yet confirmed.",
        },
      ],
    });
  if (result.status === "accepted" && !testMode)
    await recordControlledSenderTest(userId, id, selected.sender.id);
  return db.providerTestDelivery.findUnique({ where: { id: test.id } });
}
export async function disableProvider(
  userId: string,
  id: string,
  remove = false,
) {
  await getConnection(userId, id);
  await db.$transaction([
    db.providerConnection.updateMany({
      where: { id, userId },
      data: {
        enabled: false,
        health: "DISABLED",
        revision: { increment: 1 },
        ...(remove ? { deletedAt: new Date() } : {}),
      },
    }),
    db.auditEvent.create({
      data: {
        userId,
        action: remove ? "provider.deleted" : "provider.disabled",
        resourceId: id,
      },
    }),
  ]);
}
export const compatible = (
  p: {
    settings: unknown;
    enabled: boolean;
    health: string;
    cooldownUntil: Date | null;
  },
  from: string,
) =>
  p.enabled &&
  p.health === "HEALTHY" &&
  (p.settings as ConnectionInput["settings"]).messageStreamType !==
    "transactional" &&
  (!p.cooldownUntil || p.cooldownUntil <= new Date()) &&
  (p.settings as ConnectionInput["settings"]).fromEmail === from;