/*
  Warnings:

  - The primary key for the `email_tracked` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "email_tracked" DROP CONSTRAINT "email_tracked_pkey",
ALTER COLUMN "tag_id" DROP NOT NULL,
ADD CONSTRAINT "email_tracked_pkey" PRIMARY KEY ("user_id", "message_id");
