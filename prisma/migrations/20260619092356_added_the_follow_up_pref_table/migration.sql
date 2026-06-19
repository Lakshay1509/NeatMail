-- CreateTable
CREATE TABLE "follow_up_preference" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ai_drafts" BOOLEAN NOT NULL DEFAULT true,
    "days" INTEGER NOT NULL DEFAULT 3,
    "skip_emails" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "follow_up_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_preference_user_id_key" ON "follow_up_preference"("user_id");

-- AddForeignKey
ALTER TABLE "follow_up_preference" ADD CONSTRAINT "follow_up_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
