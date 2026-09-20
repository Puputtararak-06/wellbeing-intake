import { describe, expect, it } from "vitest";
import { GET as health } from "@/app/api/v1/health/route";
import { GET as services } from "@/app/api/v1/services/route";
import { POST as suggest } from "@/app/api/v1/finder/suggest/route";
import { POST as createRequest } from "@/app/api/v1/requests/route";
import { admin, call, captureLogs, requestBody, serviceId, USERS } from "./helpers";

describe("Platform conventions (NFR-18, NFR-19)", () => {
  it("health is public and content-free", async () => {
    const r = await call(health, { path: "/health" });
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(["database", "service", "status", "version"]);
    expect(r.json.database).toBe("up");
  });

  it("every response carries a correlation id and echoes a supplied one", async () => {
    const generated = await call(services, { path: "/services" });
    expect(generated.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    const supplied = await call(services, { path: "/services", headers: { "x-correlation-id": "evidence-run-0001" } });
    expect(supplied.headers.get("x-correlation-id")).toBe("evidence-run-0001");
    expect(supplied.headers.get("cache-control")).toBe("no-store");
  });

  it("the service finder is browsable without signing in (FR-01, FR-02)", async () => {
    const r = await call(services, { path: "/services" });
    expect(r.status).toBe(200);
    const list = r.json.services as Record<string, unknown>[];
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (const s of list) expect(Object.keys(s).sort()).toEqual(["firstSession", "id", "name", "slug", "whatFor", "whoWillKnow"]);
  });
});

describe("AI plus deterministic fallback (FR-23, BR-24, NFR-10)", () => {
  it("answers from the keyword matcher when AI is off, with seeded ids only", async () => {
    const clinic = await serviceId("health-clinic");
    const r = await call(suggest, { method: "POST", path: "/finder/suggest", body: { text: "I need a flu shot" } });
    expect(r.status).toBe(200);
    expect(r.json.mode).toBe("fallback");
    expect((r.json.serviceIds as string[])[0]).toBe(clinic);
    expect(Object.keys(r.json).sort()).toEqual(["mode", "serviceIds"]); // no model-written text, ever
  });

  it("falls back when AI is enabled but unavailable (no key)", async () => {
    process.env.AI_FINDER_ENABLED = "true";
    process.env.LLM_API_KEY = "";
    try {
      const r = await call(suggest, { method: "POST", path: "/finder/suggest", body: { text: "trouble sleeping" } });
      expect(r.status).toBe(200);
      expect(r.json.mode).toBe("fallback");
    } finally {
      process.env.AI_FINDER_ENABLED = "false";
    }
  });

  it("falls back when the daily budget is exhausted, storing no visitor identifier", async () => {
    process.env.AI_FINDER_ENABLED = "true";
    process.env.AI_DAILY_BUDGET = "0";
    try {
      const r = await call(suggest, { method: "POST", path: "/finder/suggest", body: { text: "back pain" } });
      expect(r.json.mode).toBe("fallback");
      const budget = await admin.from("ai_call_budget").select("*");
      for (const row of budget.data ?? []) expect(Object.keys(row).sort()).toEqual(["calls", "day"]);
    } finally {
      process.env.AI_FINDER_ENABLED = "false";
      process.env.AI_DAILY_BUDGET = "200";
    }
  });

  it("never logs or stores the typed text", async () => {
    const sentinel = "HELPER-SENTINEL-9f3a exam stress";
    const { logs } = await captureLogs(() => call(suggest, { method: "POST", path: "/finder/suggest", body: { text: sentinel } }));
    expect(logs).not.toContain("HELPER-SENTINEL");
    expect(logs).toContain('"kind":"finder"'); // mode, outcome, latency only
  });

  it("rejects over-long or extra input without echoing it", async () => {
    const r = await call(suggest, { method: "POST", path: "/finder/suggest", body: { text: "ok text", userId: "abc" } });
    expect(r.status).toBe(400);
    expect(r.text).not.toContain("abc");
  });

  it("the request path makes no AI-bound call under any flag combination", async () => {
    const source = (await import("node:fs")).readFileSync("src/app/api/v1/requests/route.ts", "utf8");
    expect(source).not.toMatch(/finder|anthropic/i);
    const helper = (await import("node:fs")).readFileSync("src/lib/finder/ai.ts", "utf8");
    expect(helper).not.toMatch(/from "@\/lib\/(authz|identity|http)|from "@\/app/); // imports nothing from the request path

    process.env.AI_FINDER_ENABLED = "true";
    try {
      const counselling = await serviceId("counselling");
      const r = await call(createRequest, { method: "POST", path: "/requests", as: USERS.studentA, body: requestBody(counselling) });
      expect(r.status).toBe(201);
      const budget = await admin.from("ai_call_budget").select("calls");
      // submitting a request consumes no AI budget
      expect((budget.data ?? []).reduce((n, b) => n + (b.calls as number), 0)).toBe(0);
    } finally {
      process.env.AI_FINDER_ENABLED = "false";
    }
  });
});

describe("Analytics prohibition (NFR-04)", () => {
  it("ships no analytics or telemetry package", async () => {
    const pkg = JSON.parse((await import("node:fs")).readFileSync("package.json", "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const d of deps) expect(d).not.toMatch(/analytics|segment|mixpanel|posthog|gtag|sentry|datadog/);
  });
});
