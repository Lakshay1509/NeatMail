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
  const envPass = process.env.BULLBOARD_PASSWORD;

  console.log("[bullboard] request path:", c.req.path);
  console.log("[bullboard] BULLBOARD_PASSWORD exists:", !!envPass);
  console.log("[bullboard] BULLBOARD_PASSWORD length:", envPass?.length ?? 0);
  console.log("[bullboard] Authorization header present:", !!auth);
  if (auth) {
    console.log(
      "[bullboard] Authorization prefix:",
      auth.slice(0, 15) + "...",
    );
  }

  if (!auth || !auth.startsWith("Basic ")) {
    console.log("[bullboard] missing or non-Basic auth, returning 401");
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Bull Board"' },
    });
  }

  const decoded = Buffer.from(auth.slice(6), "base64").toString();
  const colonIndex = decoded.indexOf(":");
  const pass = decoded.slice(colonIndex + 1);

  console.log("[bullboard] decoded length:", decoded.length);
  console.log("[bullboard] colon index:", colonIndex);
  console.log("[bullboard] received pass length:", pass.length);
  console.log("[bullboard] expected pass length:", envPass?.length ?? 0);
  console.log(
    "[bullboard] password match:",
    pass === envPass ? "YES" : "NO",
  );

  if (pass !== envPass) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Bull Board"' },
    });
  }

  await next();
});

app.route("/", serverAdapter.registerPlugin());

export default app;
