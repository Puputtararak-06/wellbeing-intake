import "server-only";

// Every secret and switch is server-only: nothing here carries a NEXT_PUBLIC_ prefix (R-2).

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("change-me")) throw new Error(`Missing required env var ${name}`);
  return v;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },

  /** BR-26: "fixture" (Supabase Auth demo users) or "campus" (Team 01 tokens). */
  get identityMode(): "fixture" | "campus" {
    return optional("IDENTITY_MODE", "fixture") === "campus" ? "campus" : "fixture";
  },
  get identityJwksUrl() {
    return required("IDENTITY_JWKS_URL");
  },
  get identityIssuer() {
    return required("IDENTITY_ISSUER");
  },
  get identityAudience() {
    return optional("IDENTITY_AUDIENCE", "wellbeing");
  },

  /** Origin allowed on cookie-authenticated writes (NFR-19). Empty = the request's own origin. */
  get appOrigin() {
    return optional("APP_ORIGIN");
  },

  // Outbound webhook to the Notification Hub (NFR-17)
  get hubWebhookUrl() {
    return optional("HUB_WEBHOOK_URL");
  },
  get hubSigningSecret() {
    return required("HUB_SIGNING_SECRET");
  },
  get hubMachineToken() {
    return optional("HUB_MACHINE_TOKEN");
  },
  /** Secret the Hub signs its inbound receipts with. */
  get hubInboundSecret() {
    return required("HUB_INBOUND_SECRET");
  },
  /** Scoped machine credential for the dispatcher route. */
  get dispatchToken() {
    return required("DISPATCH_TOKEN");
  },
  get reminderLeadHours() {
    return Number(optional("REMINDER_LEAD_HOURS", "24"));
  },
  get webhookMaxAttempts() {
    return Number(optional("WEBHOOK_MAX_ATTEMPTS", "6"));
  },
  get webhookBackoffBaseSeconds() {
    return Number(optional("WEBHOOK_BACKOFF_BASE_SECONDS", "30"));
  },

  // FR-23 helper
  get aiFinderEnabled() {
    return optional("AI_FINDER_ENABLED", "false") === "true";
  },
  get llmApiKey() {
    return optional("LLM_API_KEY");
  },
  // Groq (OpenAI-compatible API): free tier, no card — PRD C-04. `||` so an empty value means "default".
  get llmModel() {
    return optional("LLM_MODEL") || "openai/gpt-oss-20b";
  },
  get llmBaseUrl() {
    return optional("LLM_BASE_URL") || "https://api.groq.com/openai/v1";
  },
  get aiDailyBudget() {
    return Number(optional("AI_DAILY_BUDGET", "200"));
  },
  get aiTimeoutMs() {
    return Number(optional("AI_TIMEOUT_MS", "3000"));
  },

  get mockHubEnabled() {
    return optional("MOCK_HUB_ENABLED", "false") === "true";
  },
  get version() {
    return optional("VERCEL_GIT_COMMIT_SHA", "dev").slice(0, 7);
  },
};
