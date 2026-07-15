-- Data migration: give every pre-existing signup a solo organization.
--
-- Organization rows are created lazily — ensureSelfOrg() only runs from the onboarding
-- page, so users who signed up before the org feature shipped own no org. Billing is
-- unaffected (getBillingOwnerId returns the caller's own id when no membership exists),
-- but GET /organization/team returns role:"none" and TeamSettings renders a dead-end
-- "No team yet" state with no invite button — and the org is otherwise only created by
-- POST /organization/invite, which that branch never exposes. Those users can never
-- create a team. This unsticks them.
--
-- Admin is expressed by organization.created_by, NOT an ADMIN member row: role "ADMIN"
-- is only ever read (lib/organization.ts), never written — every write is "MEMBER" — and
-- an owner is expected to have no membership row at all ("Owners can't leave (no
-- membership row)", organization.ts).
--
-- id and updated_at are set explicitly: @default(uuid()) and @updatedAt are applied by
-- Prisma in application code, so the columns carry no database default and are NOT NULL.
--
-- Idempotent (NOT EXISTS + ON CONFLICT), so a re-run is a no-op. No explicit transaction:
-- Prisma wraps each migration in one.

INSERT INTO "organization" (id, name, created_by, created_at, updated_at)
SELECT
  gen_random_uuid()::text,
  CASE
    WHEN NULLIF(btrim(split_part(u.email, '@', 1)), '') IS NOT NULL
      THEN btrim(split_part(u.email, '@', 1)) || '''s org'
    ELSE 'My org'
  END,
  u.clerk_user_id,
  now(),
  now()
FROM "user_tokens" u
WHERE u.deleted_flag = false
  -- Already owns an org (created_by is UNIQUE).
  AND NOT EXISTS (
    SELECT 1 FROM "organization" o WHERE o.created_by = u.clerk_user_id
  )
  -- Belongs to someone else's team. A member must never also own an org
  -- (enforced in the /join flow), so these are deliberately left alone.
  AND NOT EXISTS (
    SELECT 1 FROM "organization_members" m WHERE m.user_id = u.clerk_user_id
  )
ON CONFLICT (created_by) DO NOTHING;

-- Surface the outcome in the migrate-deploy logs; a SELECT's rows would not be shown.
DO $$
DECLARE
  stragglers integer;
BEGIN
  SELECT count(*) INTO stragglers
  FROM "user_tokens" u
  WHERE u.deleted_flag = false
    AND NOT EXISTS (SELECT 1 FROM "organization" o WHERE o.created_by = u.clerk_user_id)
    AND NOT EXISTS (SELECT 1 FROM "organization_members" m WHERE m.user_id = u.clerk_user_id);

  RAISE NOTICE 'backfill_solo_orgs: % active user(s) still without an org or membership (expected 0)', stragglers;
END $$;
