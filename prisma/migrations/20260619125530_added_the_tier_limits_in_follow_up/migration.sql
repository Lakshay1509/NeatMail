-- AlterTable
ALTER TABLE "follow_up_preference" ADD COLUMN     "follow_up_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "follow_up_count_reset_at" TIMESTAMP(3);
