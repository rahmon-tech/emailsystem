ALTER TABLE "ProviderConnection" ADD COLUMN "monthlyBudgetOverride" INTEGER;
CREATE INDEX "DeliveryAttempt_userId_providerId_transmissionStartedAt_idx" ON "DeliveryAttempt"("userId","providerId","transmissionStartedAt");
