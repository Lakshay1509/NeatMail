-- Upgrade existing PRO subscribers to MAX
UPDATE "user_tokens"
SET "tier" = 'MAX'
WHERE "tier" = 'PRO'
  AND "clerk_user_id" IN (
    SELECT DISTINCT "clerk_user_id" FROM "subscriptions" WHERE "status" = 'active'
  );
