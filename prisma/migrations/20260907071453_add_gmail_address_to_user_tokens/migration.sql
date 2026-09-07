-- AlterTable
ALTER TABLE "user_tokens" ADD COLUMN     "gmail_address" TEXT;

-- CreateIndex
CREATE INDEX "user_tokens_gmail_address_idx" ON "user_tokens"("gmail_address");
