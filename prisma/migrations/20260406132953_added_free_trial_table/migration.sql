-- CreateEnum
CREATE TYPE "trial_status" AS ENUM ('ACTIVE', 'EXPIRED', 'CONVERTED', 'CHURNED');

-- CreateTable
CREATE TABLE "free_trial" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "trial_status" NOT NULL DEFAULT 'ACTIVE',
    "converted_at" TIMESTAMPTZ(6),
    "reminder_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "free_trial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "free_trial_user_id_key" ON "free_trial"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "free_trial_email_key" ON "free_trial"("email");

-- AddForeignKey
ALTER TABLE "free_trial" ADD CONSTRAINT "free_trial_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
