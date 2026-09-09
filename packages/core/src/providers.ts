import {
  lockSafety,
  ensureGovernor,
  commonBudgets,
  senderDomain,
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
    }),
    id: row.id,
  };
}
export async function getConnection(userId: string, id: string) {
  const row = await db.providerConnection.findFirst({
    where: { id, userId, deletedAt: null },
  });
  if (!row) throw new AppError(404, "NOT_FOUND", "Provider not found.");
  return row;
}
export async function saveProvider(
  userId: string,
  input: unknown,
  id?: string,
  dependencies: Dependencies = {},
) {
  const parsed = connectionSchema.parse(input);
  if (parsed.type === "mock" && config().ALLOW_MOCK_PROVIDER !== "true")
    throw new AppError(
      403,
      "MOCK_DISABLED",
      "Development provider is disabled.",
    );
  const previous = id ? await getConnection(userId, id) : null;
  const providerId = id ?? randomUUID();
  if (
    previous &&
    (previous.type !== parsed.type || previous.transport !== parsed.transport)
  )
    throw new AppError(
      422,
      "TYPE",
      "Create a separate connection to change provider or transport.",
    );
  const credentials = { ...parsed.credentials };
  if (previous) {
    const old = unlocked(previous).credentials;
    for (const key of [
      "webhookSecret",
      "webhookPublicKey",
      "snsTopicArn",
      "managementApiKey",
      "accountToken",
      "smtpUsername",
      "smtpPassword",
      "smtpApiKey",
    ] as const)
      if (!credentials[key] && old[key]) credentials[key] = old[key];
  }
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
          "Provider changed. Reload before saving.",
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
      "Development providers cannot be production-bootstrapped.",
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
        "Provider changed while verification was running.",
      );
    await tx.providerVerification.create({
      data: { providerId: id, status: v.status, checks: json(v.checks) },
    });
    await tx.auditEvent.create({
      data: { userId, action: "provider.verified", resourceId: id },
    });
    await syncProviderAuthorization(tx, userId, id, v);
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
    throw new AppError(422, "SUPPRESSED", "This test recipient is suppressed.");
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
          "Daily safety limit reached. Try the test after capacity becomes available.",
        );
      if (!(await governor.commit(token)))
        throw new AppError(
          409,
          "SAFETY_BUDGET",
          "Test reservation expired. Try again.",
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
