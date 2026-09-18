ALTER TABLE "ProviderConnection" ADD COLUMN "monthlyBudgetOverride" INTEGER;
UPDATE "ProviderConnection"
SET "dailyBudgetOverride"=COALESCE("dailyBudgetOverride",5000),
    "monthlyBudgetOverride"=COALESCE("monthlyBudgetOverride",150000);
CREATE INDEX "DeliveryAttempt_userId_providerId_transmissionStartedAt_idx" ON "DeliveryAttempt"("userId","providerId","transmissionStartedAt");
