import { Hono } from "hono";

/**
 * Drives a Hono sub-router the way `app/api/[[...route]]/route.ts` mounts it, without
 * loading route.ts itself — that file imports all 25 routers plus Bull Board, so pulling
 * it in to test one endpoint drags in the whole app. Mounting the router under test on a
 * fresh `basePath("/api")` gives the same paths at a fraction of the blast radius.
 *
 * The rate-limit middleware in route.ts is deliberately not reproduced here; it's covered
 * directly in tests/unit/rate-limit.test.ts.
 */

export interface ApiCallOptions {
  method?: string;
  /** Serialized as a JSON body with the matching content-type. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Sent as a single `Cookie` header. */
  cookies?: Record<string, string>;
  /** Appended as a query string. `undefined` values are dropped. */
  query?: Record<string, string | number | undefined>;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
  raw: Response;
}

export class ApiHarness {
  private app: Hono;

  constructor(mountPath: string, router: Hono) {
    this.app = new Hono().basePath("/api").route(mountPath, router as never);
  }

  async call<T = any>(
    path: string,
    options: ApiCallOptions = {},
  ): Promise<ApiResponse<T>> {
    const { method = "GET", body, headers = {}, cookies, query } = options;

    const url = new URL(`http://localhost/api${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const requestHeaders = new Headers(headers);
    if (cookies && Object.keys(cookies).length > 0) {
      requestHeaders.set(
        "Cookie",
        Object.entries(cookies)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join("; "),
      );
    }
    if (body !== undefined && !requestHeaders.has("content-type")) {
      requestHeaders.set("content-type", "application/json");
    }

    const raw = await this.app.request(url.toString(), {
      method,
      headers: requestHeaders,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    // Clone before reading: the caller gets `raw` back and may want the stream intact.
    const text = await raw.clone().text();
    let parsed: unknown = text;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      // Non-JSON response (redirect body, plain text) — hand back the raw string.
    }

    return {
      status: raw.status,
      body: parsed as T,
      headers: raw.headers,
      raw,
    };
  }

  get<T = any>(path: string, options: Omit<ApiCallOptions, "method"> = {}) {
    return this.call<T>(path, { ...options, method: "GET" });
  }
  post<T = any>(path: string, options: Omit<ApiCallOptions, "method"> = {}) {
    return this.call<T>(path, { ...options, method: "POST" });
  }
  patch<T = any>(path: string, options: Omit<ApiCallOptions, "method"> = {}) {
    return this.call<T>(path, { ...options, method: "PATCH" });
  }
  put<T = any>(path: string, options: Omit<ApiCallOptions, "method"> = {}) {
    return this.call<T>(path, { ...options, method: "PUT" });
  }
  delete<T = any>(path: string, options: Omit<ApiCallOptions, "method"> = {}) {
    return this.call<T>(path, { ...options, method: "DELETE" });
  }
}

/**
 * @example
 *   const api = mountRouter("/referral", referralRouter);
 *   const res = await api.get("/referral/code");
 */
export function mountRouter(mountPath: string, router: Hono): ApiHarness {
  return new ApiHarness(mountPath, router);
}
