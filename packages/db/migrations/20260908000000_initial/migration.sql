-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CampaignState" AS ENUM ('DRAFT', 'PREPARING', 'QUEUED', 'SENDING', 'PAUSED', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryState" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'PROVIDER_ACCEPTED', 'DELIVERED', 'DEFERRED', 'SOFT_BOUNCED', 'HARD_BOUNCED', 'FAILED', 'COMPLAINED', 'UNSUBSCRIBED', 'SUPPRESSED', 'CANCELLED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "credentials" JSONB NOT NULL,
    "credentialHint" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "health" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "cooldownUntil" TIMESTAMP(3),
    "weight" INTEGER NOT NULL DEFAULT 1,
    "perSecond" INTEGER NOT NULL DEFAULT 1,
    "perMinute" INTEGER NOT NULL DEFAULT 30,
    "concurrency" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderVerification" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderTestDelivery" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "safeError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderTestDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PREPARING',
    "stats" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRecipient" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "ImportRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" "CampaignState" NOT NULL DEFAULT 'DRAFT',
    "message" JSONB NOT NULL,
    "importId" TEXT NOT NULL,
    "preparationCursor" TEXT,
    "preparedAt" TIMESTAMP(3),
    "intendedRecipientCount" INTEGER NOT NULL DEFAULT 0,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "startKey" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "safeError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "state" "DeliveryState" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "safeError" TEXT,
    "unsubscribeToken" TEXT NOT NULL,
    "unsubscribeHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerRevision" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PROCESSING',
    "providerMessageId" TEXT,
    "category" TEXT,
    "safeError" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEvent" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "attemptId" TEXT,
    "eventKey" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "recipient" TEXT,
    "kind" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "nextMatchAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suppression" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "providerName" TEXT,
    "maskedEmail" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "ProviderConnection_userId_enabled_health_idx" ON "ProviderConnection"("userId", "enabled", "health");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_id_userId_key" ON "ProviderConnection"("id", "userId");

-- CreateIndex
CREATE INDEX "ProviderVerification_providerId_createdAt_idx" ON "ProviderVerification"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderTestDelivery_providerId_createdAt_idx" ON "ProviderTestDelivery"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactImport_userId_createdAt_idx" ON "ContactImport"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContactImport_id_userId_key" ON "ContactImport"("id", "userId");

-- CreateIndex
CREATE INDEX "ImportRecipient_importId_id_idx" ON "ImportRecipient"("importId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRecipient_importId_email_key" ON "ImportRecipient"("importId", "email");

-- CreateIndex
CREATE INDEX "Campaign_userId_createdAt_id_idx" ON "Campaign"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Campaign_state_scheduledAt_idx" ON "Campaign"("state", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_id_userId_key" ON "Campaign"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_userId_startKey_key" ON "Campaign"("userId", "startKey");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_unsubscribeToken_key" ON "Delivery"("unsubscribeToken");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_unsubscribeHash_key" ON "Delivery"("unsubscribeHash");

-- CreateIndex
CREATE INDEX "Delivery_state_nextAttemptAt_id_idx" ON "Delivery"("state", "nextAttemptAt", "id");

-- CreateIndex
CREATE INDEX "Delivery_campaignId_state_id_idx" ON "Delivery"("campaignId", "state", "id");

-- CreateIndex
CREATE INDEX "Delivery_userId_email_idx" ON "Delivery"("userId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_id_userId_key" ON "Delivery"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_campaignId_email_key" ON "Delivery"("campaignId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_idempotencyKey_key" ON "DeliveryAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_providerId_providerMessageId_idx" ON "DeliveryAttempt"("providerId", "providerMessageId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_deliveryId_startedAt_idx" ON "DeliveryAttempt"("deliveryId", "startedAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_state_startedAt_idx" ON "DeliveryAttempt"("state", "startedAt");

-- CreateIndex
CREATE INDEX "ProviderEvent_processed_nextMatchAt_idx" ON "ProviderEvent"("processed", "nextMatchAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvent_providerId_eventKey_key" ON "ProviderEvent"("providerId", "eventKey");

-- CreateIndex
CREATE INDEX "Suppression_userId_createdAt_idx" ON "Suppression"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_userId_email_key" ON "Suppression"("userId", "email");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_id_idx" ON "ActivityEvent"("userId", "id");

-- CreateIndex
CREATE INDEX "ActivityEvent_campaignId_id_idx" ON "ActivityEvent"("campaignId", "id");

-- CreateIndex
CREATE INDEX "ActivityEvent_createdAt_idx" ON "ActivityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderVerification" ADD CONSTRAINT "ProviderVerification_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderTestDelivery" ADD CONSTRAINT "ProviderTestDelivery_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactImport" ADD CONSTRAINT "ContactImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecipient" ADD CONSTRAINT "ImportRecipient_importId_userId_fkey" FOREIGN KEY ("importId", "userId") REFERENCES "ContactImport"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_campaignId_userId_fkey" FOREIGN KEY ("campaignId", "userId") REFERENCES "Campaign"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_deliveryId_userId_fkey" FOREIGN KEY ("deliveryId", "userId") REFERENCES "Delivery"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_providerId_userId_fkey" FOREIGN KEY ("providerId", "userId") REFERENCES "ProviderConnection"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEvent" ADD CONSTRAINT "ProviderEvent_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ProviderConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_campaignId_userId_fkey" FOREIGN KEY ("campaignId", "userId") REFERENCES "Campaign"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

