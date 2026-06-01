export const runtime = "nodejs";

export async function register() {
  const { startWorkers, stopWorkers } = await import(
    "@/bullmq/workers"
  );
  await startWorkers();

  return async () => {
    await stopWorkers();
  };
}
