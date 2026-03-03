import { Hono } from "hono";

const app = new Hono().post("/webhook", async (ctx) => {
  const { searchParams } = new URL(ctx.req.url);
  const validationToken = searchParams.get("validationToken");

  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
});

export default app;
