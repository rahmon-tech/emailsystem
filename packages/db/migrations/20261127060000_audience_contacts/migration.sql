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
