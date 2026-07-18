-- AlterTable. Nullable timestamp gates the first-run sweep banner (null = never
-- swept). Count defaults 0 so existing rows are valid without a backfill.
ALTER TABLE "user_tokens" ADD COLUMN     "first_sweep_at" TIMESTAMP(3);
ALTER TABLE "user_tokens" ADD COLUMN     "first_sweep_count" INTEGER NOT NULL DEFAULT 0;
