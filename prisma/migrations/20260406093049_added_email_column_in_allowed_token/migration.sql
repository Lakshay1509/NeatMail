/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `allowedToken` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `email` to the `allowedToken` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "allowedToken" ADD COLUMN     "email" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "allowedToken_email_key" ON "allowedToken"("email");
