// Reference consumer for the Wellbeing (Team 16) public API — copy into your backend and adapt.
// No dependencies; needs Node 18+ (built-in fetch). Call this from your SERVER: Wellbeing sends no
// CORS headers, so a browser on another origin cannot read the response.
//
// Contract: Team14-Integration-Contract.md (same folder)

const DEFAULTS = {
  baseUrl: "https://wellbeing-intake.vercel.app/api/v1",
  timeoutMs: 3000,
  cacheTtlMs: 10 * 60 * 1000, // the catalogue is static seed data — caching is safe and polite
  fetch: undefined, // inject your own in unit tests; defaults to the global fetch
};

/** 8–128 chars of A–Z a–z 0–9 _ . : -  — anything else is silently replaced by Wellbeing. */
export function correlationId(prefix = "team14") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createWellbeingClient(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  let cache = null; // { at: number, services: Service[] }

  async function get(path, cid) {
    const response = await (cfg.fetch ?? fetch)(`${cfg.baseUrl}${path}`, {
      headers: { accept: "application/json", "x-correlation-id": cid },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!response.ok) throw new Error(`wellbeing_http_${response.status}`);
    return response.json();
  }

  /**
   * The service catalogue. Never throws: if Wellbeing is slow, down or returns rubbish, you get the
   * last good copy (`stale: true`) or an empty list (`available: false`) — a Helpdesk ticket must
   * never be blocked by a partner outage.
   */
  async function listServices({ cid = correlationId() } = {}) {
    if (cache && Date.now() - cache.at < cfg.cacheTtlMs) {
      return { available: true, stale: false, fromCache: true, services: cache.services, cid };
    }
    try {
      const body = await get("/services", cid);
      if (!Array.isArray(body?.services)) throw new Error("wellbeing_bad_shape");
      // Keep only the fields in the contract; ignore any field Wellbeing adds later.
      const services = body.services.map((s) => ({
        slug: String(s.slug), // the STABLE id — store this, never `id` (it changes when they reseed)
        name: String(s.name),
        whatFor: String(s.whatFor),
        firstSession: String(s.firstSession),
        whoWillKnow: String(s.whoWillKnow),
      }));
      cache = { at: Date.now(), services };
      return { available: true, stale: false, fromCache: false, services, cid };
    } catch (error) {
      if (cache) return { available: true, stale: true, fromCache: true, services: cache.services, cid, error: error.message };
      return { available: false, stale: false, fromCache: false, services: [], cid, error: error.message };
    }
  }

  /** Resolve a slug stored on a ticket. `null` means "unknown service" — your not-found case. */
  async function getService(slug, opts) {
    const result = await listServices(opts);
    return { ...result, service: result.services.find((s) => s.slug === slug) ?? null };
  }

  /** true only when Wellbeing answers 200 with its database up. */
  async function isHealthy({ cid = correlationId() } = {}) {
    try {
      const body = await get("/health", cid);
      return body?.status === "ok" && body?.database === "up";
    } catch {
      return false;
    }
  }

  return { listServices, getService, isHealthy, clearCache: () => (cache = null) };
}
