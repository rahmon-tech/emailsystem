-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trackingSettings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "TrackingDomain" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "proofToken" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "verifiedUntil" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeniedDestination" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeniedDestination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingVisitDay" (
    "linkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "rawVisits" INTEGER NOT NULL DEFAULT 0,
    "likelyAutomated" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrackingVisitDay_pkey" PRIMARY KEY ("linkId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackingDomain_hostname_key" ON "TrackingDomain"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingDomain_proofToken_key" ON "TrackingDomain"("proofToken");

-- CreateIndex
CREATE INDEX "TrackingDomain_userId_enabled_idx" ON "TrackingDomain"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingDomain_id_userId_key" ON "TrackingDomain"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeniedDestination_userId_hostname_key" ON "DeniedDestination"("userId", "hostname");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_token_key" ON "TrackingLink"("token");

-- CreateIndex
CREATE INDEX "TrackingLink_userId_campaignId_idx" ON "TrackingLink"("userId", "campaignId");

-- CreateIndex
CREATE INDEX "TrackingLink_expiresAt_idx" ON "TrackingLink"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_id_userId_key" ON "TrackingLink"("id", "userId");

-- CreateIndex
CREATE INDEX "TrackingVisitDay_userId_day_idx" ON "TrackingVisitDay"("userId", "day");

-- CreateIndex
CREATE INDEX "TrackingVisitDay_day_idx" ON "TrackingVisitDay"("day");

-- AddForeignKey
ALTER TABLE "TrackingDomain" ADD CONSTRAINT "TrackingDomain_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeniedDestination" ADD CONSTRAINT "DeniedDestination_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_campaignId_userId_fkey" FOREIGN KEY ("campaignId", "userId") REFERENCES "Campaign"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_domainId_userId_fkey" FOREIGN KEY ("domainId", "userId") REFERENCES "TrackingDomain"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingVisitDay" ADD CONSTRAINT "TrackingVisitDay_linkId_userId_fkey" FOREIGN KEY ("linkId", "userId") REFERENCES "TrackingLink"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

