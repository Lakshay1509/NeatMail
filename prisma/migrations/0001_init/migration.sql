-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "user_tokens" (
    "clerk_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_history_id" TEXT,
    "watch_activated" BOOLEAN NOT NULL DEFAULT false,
    "delete_at" TIMESTAMP(3),
    "deleted_flag" BOOLEAN NOT NULL DEFAULT false,
    "use_external_ai_processing" BOOLEAN NOT NULL DEFAULT true,
    "is_gmail" BOOLEAN NOT NULL DEFAULT true,
    "outlook_id" TEXT,
    "is_folder" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("clerk_user_id")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "color" TEXT NOT NULL,
    "user_id" TEXT,
    "outlook_preset" TEXT,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tags" (
    "user_id" TEXT NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tags_pkey" PRIMARY KEY ("user_id","tag_id")
);

-- CreateTable
CREATE TABLE "email_tracked" (
    "user_id" TEXT NOT NULL,
    "tag_id" UUID NOT NULL,
    "message_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tracked_pkey" PRIMARY KEY ("user_id","tag_id","message_id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "dodo_subscription_id" TEXT NOT NULL,
    "dodo_customer_id" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "customer_name" TEXT,
    "status" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "recurring_amount" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "payment_frequency_interval" TEXT NOT NULL,
    "payment_frequency_count" INTEGER NOT NULL,
    "next_billing_date" TIMESTAMP(3),
    "previous_billing_date" TIMESTAMP(3),
    "cancel_at_next_billing_date" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMP(3),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_history" (
    "id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "dodo_payment_id" TEXT,
    "dodo_subscription_id" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL,
    "payment_type" TEXT NOT NULL,
    "billing_date" TIMESTAMP(3),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "card_last_four" TEXT,
    "card_network" TEXT,
    "card_type" TEXT,
    "checkout_session_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "invoice_id" TEXT,
    "payment_method" TEXT,
    "settlement_amount" INTEGER,

    CONSTRAINT "payment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "clerk_user_id" TEXT NOT NULL,
    "dodo_refund_id" TEXT NOT NULL,
    "dodo_payment_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "is_partial" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "payment_id" TEXT NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_preference" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "draftPrompt" TEXT,
    "signature" TEXT,
    "fontSize" SMALLINT NOT NULL DEFAULT 14,
    "fontColor" TEXT NOT NULL DEFAULT '#000000',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "draft_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_clerk_user_id_key" ON "user_tokens"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_email_key" ON "user_tokens"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tag_name_user_id_key" ON "tag"("name", "user_id");

-- CreateIndex
CREATE INDEX "idx_user_tags_tag_id" ON "user_tags"("tag_id");

-- CreateIndex
CREATE INDEX "idx_user_tags_user_id" ON "user_tags"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_tracked_message_id_key" ON "email_tracked"("message_id");

-- CreateIndex
CREATE INDEX "idx_tracked_user" ON "email_tracked"("user_id");

-- CreateIndex
CREATE INDEX "idx_tracked_user_message" ON "email_tracked"("user_id", "message_id");

-- CreateIndex
CREATE INDEX "idx_tracked_user_tag" ON "email_tracked"("user_id", "tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_dodo_subscription_id_key" ON "subscriptions"("dodo_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_clerk_user_id_idx" ON "subscriptions"("clerk_user_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_history_dodo_payment_id_key" ON "payment_history"("dodo_payment_id");

-- CreateIndex
CREATE INDEX "payment_history_clerk_user_id_idx" ON "payment_history"("clerk_user_id");

-- CreateIndex
CREATE INDEX "payment_history_subscription_id_idx" ON "payment_history"("subscription_id");

-- CreateIndex
CREATE INDEX "payment_history_status_idx" ON "payment_history"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_dodo_refund_id_key" ON "refunds"("dodo_refund_id");

-- CreateIndex
CREATE INDEX "refunds_clerk_user_id_idx" ON "refunds"("clerk_user_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "draft_preference_user_id_key" ON "draft_preference"("user_id");

-- AddForeignKey
ALTER TABLE "tag" ADD CONSTRAINT "tag_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tags" ADD CONSTRAINT "user_tags_tag_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tags" ADD CONSTRAINT "user_tags_user_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tracked" ADD CONSTRAINT "email_tracked_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tracked" ADD CONSTRAINT "email_tracked_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_clerk_user_id_fkey" FOREIGN KEY ("clerk_user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_clerk_user_id_fkey" FOREIGN KEY ("clerk_user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_clerk_user_id_fkey" FOREIGN KEY ("clerk_user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_history"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_preference" ADD CONSTRAINT "draft_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

