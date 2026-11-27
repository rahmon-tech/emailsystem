CREATE TABLE "Contact" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "firstName" TEXT NOT NULL DEFAULT '',
  "lastName" TEXT NOT NULL DEFAULT '',
  "attributes" JSONB NOT NULL DEFAULT '{}',
  "source" TEXT NOT NULL DEFAULT 'import',
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contact_id_userId_key" ON "Contact"("id","userId");
CREATE UNIQUE INDEX "Contact_userId_email_key" ON "Contact"("userId","email");
CREATE INDEX "Contact_userId_archivedAt_email_idx" ON "Contact"("userId","archivedAt","email");
CREATE INDEX "Contact_userId_createdAt_id_idx" ON "Contact"("userId","createdAt","id");

ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AudienceList" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AudienceList_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AudienceList_id_userId_key" ON "AudienceList"("id","userId");
CREATE INDEX "AudienceList_userId_createdAt_id_idx" ON "AudienceList"("userId","createdAt","id");

ALTER TABLE "AudienceList"
  ADD CONSTRAINT "AudienceList_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AudienceMembership" (
  "userId" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AudienceMembership_pkey" PRIMARY KEY ("listId","contactId")
);

CREATE INDEX "AudienceMembership_userId_contactId_idx"
  ON "AudienceMembership"("userId","contactId");
CREATE INDEX "AudienceMembership_userId_listId_createdAt_idx"
  ON "AudienceMembership"("userId","listId","createdAt");

ALTER TABLE "AudienceMembership"
  ADD CONSTRAINT "AudienceMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudienceMembership"
  ADD CONSTRAINT "AudienceMembership_listId_userId_fkey"
  FOREIGN KEY ("listId","userId") REFERENCES "AudienceList"("id","userId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AudienceMembership"
  ADD CONSTRAINT "AudienceMembership_contactId_userId_fkey"
  FOREIGN KEY ("contactId","userId") REFERENCES "Contact"("id","userId")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Contact" (
  "id","userId","email","firstName","lastName","attributes","source","createdAt","updatedAt"
)
SELECT
  gen_random_uuid()::text,
  r."userId",
  r.email,
  '',
  '',
  '{}'::jsonb,
  'import',
  MIN(i."createdAt"),
  CURRENT_TIMESTAMP
FROM "ImportRecipient" r
JOIN "ContactImport" i
  ON i.id = r."importId" AND i."userId" = r."userId"
GROUP BY r."userId", r.email
ON CONFLICT ("userId","email") DO NOTHING;

INSERT INTO "AudienceList" (
  "id","userId","name","description","createdAt","updatedAt"
)
SELECT
  i.id,
  i."userId",
  i.filename,
  '',
  i."createdAt",
  CURRENT_TIMESTAMP
FROM "ContactImport" i
WHERE i.state='READY'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "AudienceMembership" ("userId","listId","contactId","createdAt")
SELECT
  r."userId",
  r."importId",
  c.id,
  i."createdAt"
FROM "ImportRecipient" r
JOIN "ContactImport" i
  ON i.id=r."importId" AND i."userId"=r."userId"
JOIN "Contact" c
  ON c."userId"=r."userId" AND c.email=r.email
JOIN "AudienceList" l
  ON l.id=r."importId" AND l."userId"=r."userId"
ON CONFLICT ("listId","contactId") DO NOTHING;
