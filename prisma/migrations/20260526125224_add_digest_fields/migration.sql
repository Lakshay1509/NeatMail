-- AlterTable
ALTER TABLE "email_tracked" ADD COLUMN     "ai_action" TEXT,
ADD COLUMN     "ai_summary" TEXT,
ADD COLUMN     "snoozed_until" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "digest_preference" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "delivery_time" TEXT NOT NULL DEFAULT '09:00',
    "last_sent_at" TIMESTAMP(3),

    CONSTRAINT "digest_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "digest_preference_user_id_key" ON "digest_preference"("user_id");

-- CreateIndex
CREATE INDEX "idx_tracked_user_read_snooze" ON "email_tracked"("user_id", "isRead", "snoozed_until");

-- AddForeignKey
ALTER TABLE "digest_preference" ADD CONSTRAINT "digest_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
