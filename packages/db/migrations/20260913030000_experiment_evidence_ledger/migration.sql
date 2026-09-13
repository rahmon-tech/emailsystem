CREATE TABLE "ExperimentEvidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "attemptId" TEXT,
    "providerId" TEXT,
    "campaignId" TEXT,
    "payload" JSONB NOT NULL,
    "previousHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentEvidence_runId_sequence_key" ON "ExperimentEvidence"("runId", "sequence");
CREATE INDEX "ExperimentEvidence_userId_runId_sequence_idx" ON "ExperimentEvidence"("userId", "runId", "sequence");
CREATE INDEX "ExperimentEvidence_attemptId_idx" ON "ExperimentEvidence"("attemptId");

ALTER TABLE "ExperimentEvidence"
  ADD CONSTRAINT "ExperimentEvidence_runId_userId_fkey"
  FOREIGN KEY ("runId", "userId") REFERENCES "ExperimentRun"("id", "userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
