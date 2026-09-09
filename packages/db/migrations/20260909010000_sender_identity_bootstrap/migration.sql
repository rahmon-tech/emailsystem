-- Provider connections may be managed idempotently by the server-only bootstrap command.
ALTER TABLE "ProviderConnection" ADD COLUMN "bootstrapKey" TEXT;

-- A domain is owned once per tenant. Provider authorization is a separate fact.
CREATE TABLE "AuthorizedDomain" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthorizedDomain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SenderIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authorizedDomainId" TEXT NOT NULL,
    "localPart" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "replyTo" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SenderIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderDomainAuthorization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "authorizedDomainId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'DOMAIN_WIDE',
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "safeDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderDomainAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProviderSenderAuthorization" (
    "userId" TEXT NOT NULL,
    "providerDomainAuthorizationId" TEXT NOT NULL,
    "senderIdentityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderSenderAuthorization_pkey" PRIMARY KEY ("providerDomainAuthorizationId","senderIdentityId")
);

CREATE UNIQUE INDEX "ProviderConnection_userId_bootstrapKey_key" ON "ProviderConnection"("userId", "bootstrapKey");
CREATE UNIQUE INDEX "AuthorizedDomain_id_userId_key" ON "AuthorizedDomain"("id", "userId");
CREATE UNIQUE INDEX "AuthorizedDomain_userId_domain_key" ON "AuthorizedDomain"("userId", "domain");
CREATE INDEX "AuthorizedDomain_userId_status_idx" ON "AuthorizedDomain"("userId", "status");
CREATE UNIQUE INDEX "SenderIdentity_id_userId_key" ON "SenderIdentity"("id", "userId");
CREATE UNIQUE INDEX "SenderIdentity_userId_email_key" ON "SenderIdentity"("userId", "email");
CREATE UNIQUE INDEX "SenderIdentity_authorizedDomainId_localPart_key" ON "SenderIdentity"("authorizedDomainId", "localPart");
CREATE INDEX "SenderIdentity_userId_enabled_idx" ON "SenderIdentity"("userId", "enabled");
CREATE UNIQUE INDEX "ProviderDomainAuthorization_id_userId_key" ON "ProviderDomainAuthorization"("id", "userId");
CREATE UNIQUE INDEX "ProviderDomainAuthorization_providerConnectionId_authorized_key" ON "ProviderDomainAuthorization"("providerConnectionId", "authorizedDomainId");
CREATE INDEX "ProviderDomainAuthorization_userId_status_idx" ON "ProviderDomainAuthorization"("userId", "status");
CREATE INDEX "ProviderDomainAuthorization_authorizedDomainId_status_idx" ON "ProviderDomainAuthorization"("authorizedDomainId", "status");
CREATE INDEX "ProviderSenderAuthorization_userId_senderIdentityId_idx" ON "ProviderSenderAuthorization"("userId", "senderIdentityId");

ALTER TABLE "AuthorizedDomain" ADD CONSTRAINT "AuthorizedDomain_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SenderIdentity" ADD CONSTRAINT "SenderIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SenderIdentity" ADD CONSTRAINT "SenderIdentity_authorizedDomainId_userId_fkey" FOREIGN KEY ("authorizedDomainId", "userId") REFERENCES "AuthorizedDomain"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderDomainAuthorization" ADD CONSTRAINT "ProviderDomainAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderDomainAuthorization" ADD CONSTRAINT "ProviderDomainAuthorization_providerConnectionId_userId_fkey" FOREIGN KEY ("providerConnectionId", "userId") REFERENCES "ProviderConnection"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderDomainAuthorization" ADD CONSTRAINT "ProviderDomainAuthorization_authorizedDomainId_userId_fkey" FOREIGN KEY ("authorizedDomainId", "userId") REFERENCES "AuthorizedDomain"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderSenderAuthorization" ADD CONSTRAINT "ProviderSenderAuthorization_providerDomainAuthorizationId__fkey" FOREIGN KEY ("providerDomainAuthorizationId", "userId") REFERENCES "ProviderDomainAuthorization"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProviderSenderAuthorization" ADD CONSTRAINT "ProviderSenderAuthorization_senderIdentityId_userId_fkey" FOREIGN KEY ("senderIdentityId", "userId") REFERENCES "SenderIdentity"("id", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve configured senders as explicit tenant-owned records. Existing real-provider
-- verification is not treated as domain evidence; operators must re-check it.
INSERT INTO "AuthorizedDomain" ("id", "userId", "domain", "status", "createdAt", "updatedAt")
SELECT DISTINCT
    md5(p."userId" || ':domain:' || lower(split_part(p."settings"->>'fromEmail', '@', 2)))::uuid::text,
    p."userId",
    lower(split_part(p."settings"->>'fromEmail', '@', 2)),
    CASE WHEN p."type" = 'mock' AND p."health" = 'HEALTHY' THEN 'VERIFIED' ELSE 'UNVERIFIED' END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ProviderConnection" p
WHERE p."settings"->>'fromEmail' LIKE '%@%'
ON CONFLICT ("userId", "domain") DO NOTHING;

INSERT INTO "SenderIdentity" ("id", "userId", "authorizedDomainId", "localPart", "email", "displayName", "replyTo", "enabled", "createdAt", "updatedAt")
SELECT DISTINCT ON (p."userId", lower(p."settings"->>'fromEmail'))
    md5(p."userId" || ':sender:' || lower(p."settings"->>'fromEmail'))::uuid::text,
    p."userId",
    d."id",
    lower(split_part(p."settings"->>'fromEmail', '@', 1)),
    lower(p."settings"->>'fromEmail'),
    COALESCE(p."settings"->>'fromName', ''),
    COALESCE(p."settings"->>'replyTo', ''),
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ProviderConnection" p
JOIN "AuthorizedDomain" d
  ON d."userId" = p."userId"
 AND d."domain" = lower(split_part(p."settings"->>'fromEmail', '@', 2))
WHERE p."settings"->>'fromEmail' LIKE '%@%'
ORDER BY p."userId", lower(p."settings"->>'fromEmail'), p."createdAt"
ON CONFLICT ("userId", "email") DO NOTHING;

INSERT INTO "ProviderDomainAuthorization" ("id", "userId", "providerConnectionId", "authorizedDomainId", "scope", "status", "verifiedAt", "safeDetail", "createdAt", "updatedAt")
SELECT
    md5(p."id" || ':authorization:' || d."id")::uuid::text,
    p."userId",
    p."id",
    d."id",
    'DOMAIN_WIDE',
    CASE WHEN p."type" = 'mock' AND p."health" = 'HEALTHY' THEN 'VERIFIED' ELSE 'UNVERIFIED' END,
    CASE WHEN p."type" = 'mock' AND p."health" = 'HEALTHY' THEN CURRENT_TIMESTAMP ELSE NULL END,
    CASE WHEN p."type" = 'mock' AND p."health" = 'HEALTHY' THEN 'Development simulation only.' ELSE 'Re-check provider authorization.' END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ProviderConnection" p
JOIN "AuthorizedDomain" d
  ON d."userId" = p."userId"
 AND d."domain" = lower(split_part(p."settings"->>'fromEmail', '@', 2))
WHERE p."settings"->>'fromEmail' LIKE '%@%'
ON CONFLICT ("providerConnectionId", "authorizedDomainId") DO NOTHING;

ALTER TABLE "Campaign" ADD COLUMN "senderIdentityId" TEXT;
UPDATE "Campaign" c
SET "senderIdentityId" = s."id"
FROM "SenderIdentity" s
WHERE s."userId" = c."userId"
  AND s."email" = lower(c."message"->>'from');
CREATE INDEX "Campaign_userId_senderIdentityId_idx" ON "Campaign"("userId", "senderIdentityId");
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_senderIdentityId_userId_fkey" FOREIGN KEY ("senderIdentityId", "userId") REFERENCES "SenderIdentity"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Redirects now use APP_URL. Preserve existing opaque links and aggregate history;
-- the deployment owner must route APP_URL/r/* before enabling tracking again.
ALTER TABLE "TrackingLink" DROP CONSTRAINT IF EXISTS "TrackingLink_domainId_userId_fkey";
ALTER TABLE "TrackingLink" DROP COLUMN "domainId";
DROP TABLE "TrackingDomain";
UPDATE "User"
SET "trackingSettings" =
    (COALESCE("trackingSettings", '{}'::jsonb) - 'defaultDomainId')
    || jsonb_build_object('defaultEnabled', false);
