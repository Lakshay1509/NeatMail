/*
  Warnings:

  - A unique constraint covering the columns `[chat_id]` on the table `TelegramIntegration` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "TelegramIntegration_chat_id_key" ON "TelegramIntegration"("chat_id");
