CREATE TABLE "DomainSafetyPause" (
  "userId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "pausedReason" TEXT,
  "pausedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "DomainSafetyPause_pkey" PRIMARY KEY ("userId","domain")
);
CREATE INDEX "DomainSafetyPause_userId_pausedReason_idx" ON "DomainSafetyPause"("userId","pausedReason");
ALTER TABLE "DomainSafetyPause"
  ADD CONSTRAINT "DomainSafetyPause_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
