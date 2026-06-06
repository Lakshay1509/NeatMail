-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('FREE', 'PRO', 'MAX');

-- AlterTable
ALTER TABLE "user_tokens" ADD COLUMN     "tier" "Tier" NOT NULL DEFAULT 'FREE';

-- DataMigration: set existing paid subscribers to PRO
UPDATE "user_tokens"
SET "tier" = 'PRO'
WHERE "clerk_user_id" IN (
  SELECT DISTINCT "clerk_user_id" FROM "subscriptions" WHERE "status" = 'active'
);
