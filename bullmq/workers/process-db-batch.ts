import { flushEmailBatch } from "@/lib/batch-insert";

export async function processDbBatch(): Promise<{ inserted: number }> {
  const inserted = await flushEmailBatch();
  return { inserted };
}

export default processDbBatch;
