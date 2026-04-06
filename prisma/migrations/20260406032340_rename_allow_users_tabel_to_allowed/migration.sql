/*
  Warnings:

  - You are about to drop the `allowUsers` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "allowUsers";

-- CreateTable
CREATE TABLE "allowedUsers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "allowedUsers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allowedUsers_email_key" ON "allowedUsers"("email");
