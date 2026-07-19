-- AlterEnum
-- Adds the AUTO source for engagement-based auto-archive rules (see lib/engagement.ts).
-- Additive only, and unused within this migration, so it's safe inside migrate
-- deploy's transaction on Postgres 12+.
ALTER TYPE "ArchiveRuleSource" ADD VALUE 'AUTO';
