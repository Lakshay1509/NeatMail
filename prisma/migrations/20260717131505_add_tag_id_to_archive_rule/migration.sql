-- AlterTable
ALTER TABLE "ArchiveRule" ADD COLUMN     "tag_id" UUID,
ALTER COLUMN "domain" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ArchiveRule_isActive_tag_id_idx" ON "ArchiveRule"("isActive", "tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveRule_user_id_tag_id_key" ON "ArchiveRule"("user_id", "tag_id");

-- AddForeignKey
ALTER TABLE "ArchiveRule" ADD CONSTRAINT "ArchiveRule_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A rule must target exactly one of domain/tag_id (Prisma can't express this).
-- Existing rows already have a non-null domain and null tag_id.
ALTER TABLE "ArchiveRule" ADD CONSTRAINT "ArchiveRule_exactly_one_target"
  CHECK (("domain" IS NOT NULL AND "tag_id" IS NULL)
      OR ("domain" IS NULL AND "tag_id" IS NOT NULL));
