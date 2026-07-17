-- CreateEnum
CREATE TYPE "ArchiveRuleSource" AS ENUM ('USER', 'SEEDED');

-- AlterTable. Default USER so every pre-existing rule keeps sweeping the
-- backlog, which is the behaviour it already had before this column existed.
ALTER TABLE "ArchiveRule" ADD COLUMN     "source" "ArchiveRuleSource" NOT NULL DEFAULT 'USER';
