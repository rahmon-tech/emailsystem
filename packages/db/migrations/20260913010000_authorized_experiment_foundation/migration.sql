CREATE TYPE "ExperimentRunState" AS ENUM ('READY', 'RUNNING', 'STOPPED', 'COMPLETED', 'EXPIRED');

ALTER TABLE "User"
  ADD COLUMN "experimentKillSwitchAt" TIMESTAMP(3),
  ADD COLUMN "experimentKillSwitchReason" TEXT;

CREATE TABLE "ExperimentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "authorizationRef" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "variables" JSONB NOT NULL DEFAULT '{}',
    "maxRecipients" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL,
    "maxDurationSeconds" INTEGER NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExperimentProviderScope" (
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentProviderScope_pkey" PRIMARY KEY ("profileId","providerId")
);

CREATE TABLE "ExperimentSenderScope" (
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "senderIdentityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentSenderScope_pkey" PRIMARY KEY ("profileId","senderIdentityId")
);

CREATE TABLE "ExperimentRecipient" (
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExperimentRecipient_pkey" PRIMARY KEY ("profileId","email")
);

CREATE TABLE "ExperimentRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "authorizationRef" TEXT NOT NULL,
    "state" "ExperimentRunState" NOT NULL DEFAULT 'READY',
    "maxRecipients" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL,
    "maxDurationSeconds" INTEGER NOT NULL,
    "recipientsUsed" INTEGER NOT NULL DEFAULT 0,
    "attemptsUsed" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "killSwitchAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExperimentRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentProfile_id_userId_key" ON "ExperimentProfile"("id", "userId");
CREATE INDEX "ExperimentProfile_userId_createdAt_idx" ON "ExperimentProfile"("userId", "createdAt");
CREATE INDEX "ExperimentProviderScope_userId_providerId_idx" ON "ExperimentProviderScope"("userId", "providerId");
CREATE INDEX "ExperimentSenderScope_userId_senderIdentityId_idx" ON "ExperimentSenderScope"("userId", "senderIdentityId");
CREATE INDEX "ExperimentRecipient_userId_email_idx" ON "ExperimentRecipient"("userId", "email");
CREATE UNIQUE INDEX "ExperimentRun_id_userId_key" ON "ExperimentRun"("id", "userId");
CREATE INDEX "ExperimentRun_userId_createdAt_idx" ON "ExperimentRun"("userId", "createdAt");
CREATE INDEX "ExperimentRun_userId_state_expiresAt_idx" ON "ExperimentRun"("userId", "state", "expiresAt");

ALTER TABLE "ExperimentProfile" ADD CONSTRAINT "ExperimentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExperimentProviderScope" ADD CONSTRAINT "ExperimentProviderScope_profileId_userId_fkey" FOREIGN KEY ("profileId", "userId") REFERENCES "ExperimentProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExperimentProviderScope" ADD CONSTRAINT "ExperimentProviderScope_providerId_userId_fkey" FOREIGN KEY ("providerId", "userId") REFERENCES "ProviderConnection"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExperimentSenderScope" ADD CONSTRAINT "ExperimentSenderScope_profileId_userId_fkey" FOREIGN KEY ("profileId", "userId") REFERENCES "ExperimentProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExperimentSenderScope" ADD CONSTRAINT "ExperimentSenderScope_senderIdentityId_userId_fkey" FOREIGN KEY ("senderIdentityId", "userId") REFERENCES "SenderIdentity"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExperimentRecipient" ADD CONSTRAINT "ExperimentRecipient_profileId_userId_fkey" FOREIGN KEY ("profileId", "userId") REFERENCES "ExperimentProfile"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExperimentRun" ADD CONSTRAINT "ExperimentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExperimentRun" ADD CONSTRAINT "ExperimentRun_profileId_userId_fkey" FOREIGN KEY ("profileId", "userId") REFERENCES "ExperimentProfile"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
