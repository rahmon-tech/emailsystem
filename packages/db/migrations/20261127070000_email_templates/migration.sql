CREATE TABLE "EmailTemplate" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'Custom',
  "subject" TEXT NOT NULL DEFAULT '',
  "preheader" TEXT NOT NULL DEFAULT '',
  "html" TEXT NOT NULL,
  "text" TEXT NOT NULL DEFAULT '',
  "editorMode" TEXT NOT NULL DEFAULT 'rich',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailTemplate_id_userId_key"
  ON "EmailTemplate"("id","userId");
CREATE INDEX "EmailTemplate_userId_updatedAt_id_idx"
  ON "EmailTemplate"("userId","updatedAt","id");

ALTER TABLE "EmailTemplate"
  ADD CONSTRAINT "EmailTemplate_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
