-- CreateIndex
CREATE INDEX "idx_tracked_user_domain" ON "email_tracked"("user_id", "domain");
