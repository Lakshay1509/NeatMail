import { Hono } from "hono";
import { createBullBoard } from "@bull-board/api";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { queueAdapters } from "@/lib/queue";

const serverAdapter = new HonoAdapter(serveStatic);

createBullBoard({
  queues: queueAdapters,
  serverAdapter,
});

serverAdapter.setBasePath("/api/bullboard");

const app = new Hono();

app.use("*", async (c, next) => {
  const auth = c.req.header("Authorization");

  if (!auth || !auth.startsWith("Basic ")) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Bull Board"' },
    });
  }

  const decoded = Buffer.from(auth.slice(6), "base64").toString();
  const colonIndex = decoded.indexOf(":");
  const pass = decoded.slice(colonIndex + 1);

  if (pass !== process.env.BULLBOARD_PASSWORD) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Bull Board"' },
    });
  }

  await next();
});

app.route("/", serverAdapter.registerPlugin());

export default app;
