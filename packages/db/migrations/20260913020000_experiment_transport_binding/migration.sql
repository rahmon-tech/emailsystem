ALTER TABLE "Campaign"
  ADD COLUMN "experimentRunId" TEXT;

ALTER TABLE "DeliveryAttempt"
  ADD COLUMN "experimentRunId" TEXT;

CREATE TABLE "ExperimentRunRecipientUse" (
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentRunRecipientUse_pkey" PRIMARY KEY ("runId","email")
);

CREATE UNIQUE INDEX "Campaign_experimentRunId_userId_key" ON "Campaign"("experimentRunId", "userId");
CREATE INDEX "Campaign_userId_experimentRunId_idx" ON "Campaign"("userId", "experimentRunId");
CREATE INDEX "DeliveryAttempt_experimentRunId_startedAt_idx" ON "DeliveryAttempt"("experimentRunId", "startedAt");
CREATE INDEX "ExperimentRunRecipientUse_userId_email_idx" ON "ExperimentRunRecipientUse"("userId", "email");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_experimentRunId_userId_fkey" FOREIGN KEY ("experimentRunId", "userId") REFERENCES "ExperimentRun"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_experimentRunId_userId_fkey" FOREIGN KEY ("experimentRunId", "userId") REFERENCES "ExperimentRun"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExperimentRunRecipientUse" ADD CONSTRAINT "ExperimentRunRecipientUse_runId_userId_fkey" FOREIGN KEY ("runId", "userId") REFERENCES "ExperimentRun"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
