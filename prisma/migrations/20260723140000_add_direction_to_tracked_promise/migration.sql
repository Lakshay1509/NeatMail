-- CreateEnum
CREATE TYPE "PromiseDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterTable
-- Existing rows are all inbound ("they owe me"), so INBOUND is the correct backfill.
ALTER TABLE "tracked_promise" ADD COLUMN     "direction" "PromiseDirection" NOT NULL DEFAULT 'INBOUND';
