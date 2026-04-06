-- CreateTable
CREATE TABLE "allowUsers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "allowUsers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allowUsers_email_key" ON "allowUsers"("email");
