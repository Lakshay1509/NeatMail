-- AlterTable
ALTER TABLE "email_tracked" ADD COLUMN     "domain" TEXT,
ADD COLUMN     "isRead" BOOLEAN NOT NULL DEFAULT false;
