-- Existing rows have unknown mode. New tests explicitly persist true or false.
ALTER TABLE "ProviderTestDelivery" ADD COLUMN "testMode" BOOLEAN;
