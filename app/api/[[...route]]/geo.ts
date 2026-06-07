import { getRegionFromCountry, type BillingRegion } from "@/lib/tiers";
import { Hono } from "hono";

const app = new Hono().get("/", (ctx) => {
  const country = ctx.req.header("cf-ipcountry") ?? "";
  const region: BillingRegion = getRegionFromCountry(country);
  return ctx.json({ region }, 200);
});

export default app;
