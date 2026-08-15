import { describe, expect, it } from "bun:test";

import geo from "@/app/api/[[...route]]/geo";
import { mountRouter } from "../helpers/api";

const api = mountRouter("/geo", geo);

describe("GET /api/geo", () => {
  it("returns IN for an Indian request", async () => {
    const res = await api.get("/geo", { headers: { "cf-ipcountry": "IN" } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ region: "IN" });
  });

  it("returns GLOBAL for every other country", async () => {
    for (const country of ["US", "GB", "DE", "AU", "SG"]) {
      const res = await api.get("/geo", { headers: { "cf-ipcountry": country } });
      expect(res.body).toEqual({ region: "GLOBAL" });
    }
  });

  it("falls back to GLOBAL when Cloudflare sends no country header", async () => {
    // Local dev and any non-Cloudflare origin hit this path; it must not 500.
    const res = await api.get("/geo");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ region: "GLOBAL" });
  });

  it("is case-sensitive on the country code, as Cloudflare always sends uppercase", async () => {
    const res = await api.get("/geo", { headers: { "cf-ipcountry": "in" } });

    expect(res.body).toEqual({ region: "GLOBAL" });
  });
});
