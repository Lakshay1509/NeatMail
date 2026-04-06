/*
  Warnings:

  - You are about to drop the `allowedUsers` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "allowedUsers";

-- CreateTable
CREATE TABLE "allowedToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "is_used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "allowedToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allowedToken_token_key" ON "allowedToken"("token");
