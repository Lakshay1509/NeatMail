-- CreateTable
CREATE TABLE "telegramPendingDraft" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "telegram_msg_id" INTEGER NOT NULL,
    "draft_id" TEXT NOT NULL,
    "quick_options" TEXT[],
    "awaiting_custom" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegramPendingDraft_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "telegramPendingDraft" ADD CONSTRAINT "telegramPendingDraft_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
