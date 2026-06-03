export const runtime = "nodejs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorkers, stopWorkers } = await import(
      "@/bullmq/workers"
    );
    await startWorkers();

    return async () => {
      await stopWorkers();
    };
  }
}
