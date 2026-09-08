ALTER TABLE "User" ADD COLUMN "safetySettings" JSONB NOT NULL DEFAULT '{}', ADD COLUMN "safetyPausedReason" TEXT, ADD COLUMN "safetyReviewedAt" TIMESTAMP(3);
ALTER TABLE "ProviderConnection" ADD COLUMN "dailyBudgetOverride" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN "dailyBudget" INTEGER DEFAULT 5000, ADD COLUMN "safetyWaitUntil" TIMESTAMP(3), ADD COLUMN "safetyWaitReason" TEXT, ADD COLUMN "safetyPausedReason" TEXT, ADD COLUMN "safetyReviewedAt" TIMESTAMP(3);
ALTER TABLE "DeliveryAttempt" ADD COLUMN "safetyReservedAt" TIMESTAMP(3), ADD COLUMN "transmissionStartedAt" TIMESTAMP(3), ADD COLUMN "messageUnits" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "senderDomain" TEXT NOT NULL DEFAULT '';
-- Every historical attempt may have transmitted. Preserve it conservatively,
-- including UNKNOWN, and derive copies/domain from its immutable campaign.
UPDATE "DeliveryAttempt" a SET "safetyReservedAt"=a."startedAt", "transmissionStartedAt"=a."startedAt", "messageUnits"=1+jsonb_array_length(COALESCE(c.message->'cc','[]'))+jsonb_array_length(COALESCE(c.message->'bcc','[]')), "senderDomain"=lower(split_part(c.message->>'from','@',2)) FROM "Delivery" d JOIN "Campaign" c ON c.id=d."campaignId" WHERE d.id=a."deliveryId";
CREATE INDEX "DeliveryAttempt_userId_transmissionStartedAt_idx" ON "DeliveryAttempt"("userId","transmissionStartedAt");
CREATE INDEX "DeliveryAttempt_userId_state_startedAt_idx" ON "DeliveryAttempt"("userId",state,"startedAt");
CREATE INDEX "ProviderEvent_attemptId_kind_processed_idx" ON "ProviderEvent"("attemptId",kind,processed);
ALTER TABLE "ProviderTestDelivery" ADD COLUMN "safetyAt" TIMESTAMP(3), ADD COLUMN "senderDomain" TEXT NOT NULL DEFAULT '';
UPDATE "ProviderTestDelivery" t SET "safetyAt"=t."createdAt", "senderDomain"=lower(split_part(p.settings->>'fromEmail','@',2)) FROM "ProviderConnection" p WHERE p.id=t."providerId";
