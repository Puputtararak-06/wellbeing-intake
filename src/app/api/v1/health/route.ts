import { route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

// NFR-19: public, content-free liveness/readiness for the gateway and the runbook.
export const GET = route({
  access: "public",
  handler: async () => {
    let database: "up" | "down" = "down";
    try {
      const { error } = await db().from("triage_level").select("id", { count: "exact", head: true });
      database = error ? "down" : "up";
    } catch {
      database = "down";
    }
    const healthy = database === "up";
    return {
      status: healthy ? 200 : 503,
      json: { status: healthy ? "ok" : "degraded", service: "wellbeing", version: env.version, database },
    };
  },
});
