ALTER TABLE "ProviderConnection" ADD COLUMN "quotaRemaining" INTEGER;
ALTER TABLE "ProviderConnection" ADD COLUMN "quotaCheckedAt" TIMESTAMP(3);
