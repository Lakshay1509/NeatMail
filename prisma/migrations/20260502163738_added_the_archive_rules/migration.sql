-- AlterTable
ALTER TABLE "email_tracked" ADD COLUMN     "archive_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "ArchiveRule" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "archiveAfterDays" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ArchiveRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchiveRule_isActive_user_id_idx" ON "ArchiveRule"("isActive", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveRule_user_id_domain_key" ON "ArchiveRule"("user_id", "domain");

-- AddForeignKey
ALTER TABLE "ArchiveRule" ADD CONSTRAINT "ArchiveRule_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
