import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

// Deterministic test configuration. Every boundary is mocked (NFR-14): no Hub URL unless a
// test sets one, AI off so the fallback answers, fixture identities.
process.env.IDENTITY_MODE = "fixture";
process.env.HUB_WEBHOOK_URL = "";
process.env.HUB_SIGNING_SECRET = "test-outbound-secret";
process.env.HUB_INBOUND_SECRET = "test-inbound-secret";
process.env.DISPATCH_TOKEN = "test-dispatch-token";
process.env.AI_FINDER_ENABLED = "false";
process.env.APP_ORIGIN = "http://localhost:3000";
process.env.WEBHOOK_BACKOFF_BASE_SECONDS = "30";
process.env.WEBHOOK_MAX_ATTEMPTS = "3";
