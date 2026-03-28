-- CreateTable
CREATE TABLE "integration_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integration_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_integration_rules_user_id" ON "integration_rules"("user_id");

-- CreateIndex
CREATE INDEX "idx_integration_rules_tag_id" ON "integration_rules"("tag_id");

-- CreateIndex
CREATE INDEX "idx_integration_rules_domain" ON "integration_rules"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "idx_integration_rules_user_domain" ON "integration_rules"("user_id", "domain");

-- AddForeignKey
ALTER TABLE "integration_rules" ADD CONSTRAINT "integration_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_tokens"("clerk_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_rules" ADD CONSTRAINT "integration_rules_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
