-- AlterTable
ALTER TABLE "draft_preference" ADD COLUMN     "draft_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "draft_count_reset_at" TIMESTAMP(3);
