-- CreateEnum
CREATE TYPE "PromiseStatus" AS ENUM ('PENDING', 'NUDGED', 'FULFILLED', 'DISMISSED');

-- AlterTable
ALTER TABLE "follow_up_preference" ADD COLUMN     "track_promises" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "tracked_promise" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "from_domain" TEXT,
    "item" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "PromiseStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION,
    "nudged_at" TIMESTAMPTZ(6),
    "fulfilled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_promise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_promise_status_due" ON "tracked_promise"("status", "due_at");

-- CreateIndex
CREATE INDEX "idx_promise_user_thread" ON "tracked_promise"("user_id", "thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_promise_user_id_message_id_key" ON "tracked_promise"("user_id", "message_id");

-- AddForeignKey
ALTER TABLE "tracked_promise" ADD CONSTRAINT "tracked_promise_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;
