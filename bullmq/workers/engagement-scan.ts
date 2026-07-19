import { runEngagementScan } from "@/lib/engagement";

// Runs on a repeatable schedule (see bullmq/workers/index.ts): does the
// per-sender engagement aggregation and writes AUTO archive rules. Enforcing
// those rules on arrival happens separately, in the mail workers.
export async function processEngagementScan() {
  const result = await runEngagementScan();
  console.log(
    `[engagement-scan] scanned ${result.usersScanned} users, created ${result.rulesCreated} auto-mute rules`,
  );
  return result;
}

export default processEngagementScan;
