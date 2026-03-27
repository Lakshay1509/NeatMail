-- CreateTable
CREATE TABLE "TelegramIntegration" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,

    CONSTRAINT "TelegramIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramIntegration_user_id_key" ON "TelegramIntegration"("user_id");

-- AddForeignKey
ALTER TABLE "TelegramIntegration" ADD CONSTRAINT "TelegramIntegration_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
