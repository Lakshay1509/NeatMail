import { flushClassifyBatch } from "@/lib/classify-batch";

export async function processClassify(): Promise<{ flushed: number }> {
  const flushed = await flushClassifyBatch();
  return { flushed };
}

export default processClassify;
