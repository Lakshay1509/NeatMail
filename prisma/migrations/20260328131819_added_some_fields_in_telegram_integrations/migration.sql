-- AlterTable
ALTER TABLE "TelegramIntegration" ADD COLUMN     "forward_draft_for_confirmation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forward_important_mails" BOOLEAN NOT NULL DEFAULT false;
