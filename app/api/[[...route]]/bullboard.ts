import { Hono } from "hono";
import { createBullBoard } from "@bull-board/api";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { timingSafeEqual } from "node:crypto";
import { queueAdapters } from "@/lib/queue";
import {
  bullboardAuthLimiter,
  bullboardGlobalAuthLimiter,
  getIdentifier,
} from "@/lib/rate-limit";

const serverAdapter = new HonoAdapter(serveStatic);

createBullBoard({
  queues: queueAdapters,
  serverAdapter,
});

serverAdapter.setBasePath("/api/bullboard");

const MIN_PASSWORD_LENGTH = 8;

const app = new Hono();

app.use("*", async (c, next) => {
  const envPass = process.env.BULLBOARD_PASSWORD;

  if (!envPass) {
    return new Response("Service unavailable", { status: 503 });
  }

  if (envPass.length < MIN_PASSWORD_LENGTH) {
    console.error("[bullboard] password too short, refusing to serve");
    return new Response("Service unavailable", { status: 503 });
  }

  const auth = c.req.header("Authorization");
  const identifier = getIdentifier(c.req.raw, null);

  let authorized = false;

  if (auth && auth.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString();
    const colonIndex = decoded.indexOf(":");
    const pass = decoded.slice(colonIndex + 1);

    const passBuf = Buffer.from(pass);
    const envBuf = Buffer.from(envPass);

    authorized =
      passBuf.length === envBuf.length && timingSafeEqual(passBuf, envBuf);
  }

  if (!authorized) {
    const [perIpLimit, globalLimit] = await Promise.all([
      bullboardAuthLimiter.limit(identifier),
      bullboardGlobalAuthLimiter.limit("global"),
    ]);

    if (!perIpLimit.success || !globalLimit.success) {
      console.warn(`[bullboard] rate limited: ${identifier}`);
      return new Response("Too many requests", { status: 429 });
    }

    console.warn(`[bullboard] auth failed: ${identifier}`);

    await new Promise((r) => setTimeout(r, 1000));

    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Bull Board"' },
    });
  }

  await next();
});

app.route("/", serverAdapter.registerPlugin());

export default app;
