// Runs Team 14's integration test plan against the live Wellbeing API.
//   node smoke-test.mjs
// Exit code 0 = every applicable test passed. Tests 5 and 6 (webhook, duplicate event) are N/A:
// Wellbeing sends no events to Helpdesk — see the contract, section 8.
import { createWellbeingClient } from "./wellbeing-client.mjs";

const BASE = process.env.WELLBEING_BASE_URL ?? "https://wellbeing-intake.vercel.app/api/v1";
const SLUGS = ["counselling", "health-clinic", "physiotherapy", "wellbeing-advising"];
let failed = 0;

async function test(name, fn) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? "  — " + detail : ""}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}  — ${error.message}`);
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

await test("1 valid request: GET /services -> 200, four services, correlation id echoed", async () => {
  const cid = "team14-smoke-0001";
  const r = await fetch(`${BASE}/services`, { headers: { "x-correlation-id": cid } });
  const body = await r.json();
  assert(r.status === 200, `status ${r.status}`);
  assert(r.headers.get("x-correlation-id") === cid, "correlation id not echoed");
  assert(JSON.stringify(body.services.map((s) => s.slug).sort()) === JSON.stringify(SLUGS), "unexpected slugs");
  for (const s of body.services) for (const k of ["id", "slug", "name", "whatFor", "firstSession", "whoWillKnow"]) assert(typeof s[k] === "string" && s[k], `missing ${k}`);
  return `${body.services.length} services`;
});

await test("2 invalid request: POST /services -> 405", async () => {
  const r = await fetch(`${BASE}/services`, { method: "POST" });
  assert(r.status === 405, `status ${r.status}`);
});

await test("3 authentication failure (outside this contract): GET /requests/me without a token -> 401", async () => {
  const r = await fetch(`${BASE}/requests/me`);
  assert(r.status === 401 && (await r.json()).error === "unauthenticated", `status ${r.status}`);
});

await test("4 unknown resource: slug 'dentistry' -> not found", async () => {
  const { service, available } = await createWellbeingClient({ baseUrl: BASE }).getService("dentistry");
  assert(available && service === null, "expected null");
});

await test("4b known resource: slug 'counselling' resolves", async () => {
  const { service } = await createWellbeingClient({ baseUrl: BASE }).getService("counselling");
  assert(service?.name === "Counselling", "not resolved");
  return service.name;
});

console.log("N/A   5 webhook, 6 duplicate event — Wellbeing sends no events to Helpdesk");

await test("7 partner failure: unreachable host -> client does not throw, reports unavailable", async () => {
  const broken = createWellbeingClient({ baseUrl: "https://wellbeing-intake.invalid/api/v1", timeoutMs: 1500 });
  const r = await broken.listServices();
  assert(r.available === false && r.services.length === 0 && r.error, "should degrade, not throw");
  return r.error;
});

await test("7b partner failure with a warm cache -> stale copy is served", async () => {
  let down = false; // simulate the outage at the network layer, keeping one client (and its cache)
  const flaky = (...args) => (down ? Promise.reject(new TypeError("fetch failed")) : fetch(...args));
  const client = createWellbeingClient({ baseUrl: BASE, cacheTtlMs: 0, fetch: flaky });
  assert((await client.listServices()).services.length === 4, "warm-up failed");
  down = true;
  const r = await client.listServices();
  assert(r.stale === true && r.services.length === 4, "expected stale copy");
  down = false; // 8 recovery: partner is back, next call is fresh — no manual repair
  const again = await client.listServices();
  assert(again.stale === false && again.fromCache === false, "did not recover");
  return "stale during outage, fresh after recovery (test 8)";
});

await test("health: GET /health -> ok, database up", async () => {
  assert(await createWellbeingClient({ baseUrl: BASE }).isHealthy(), "not healthy");
});

console.log(failed ? `\n${failed} test(s) failed` : "\nAll applicable tests passed");
process.exit(failed ? 1 : 0);
