import { route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

// FR-10 / BR-05: own service only, most urgent first, then oldest first.
// METADATA ONLY — the SELECT never names a content column, so loading the queue is not
// a content view and emits no audit event (BR-07).
export const GET = route({
  access: ["practitioner"],
  handler: async ({ caller }) => {
    const { data, error } = await db()
      .from("request")
      .select("id, triage_level_id, status, submitted_at")
      .eq("service_id", caller!.serviceId!)
      .order("triage_level_id", { ascending: false })
      .order("submitted_at", { ascending: true });
    if (error) throw new Error("read_failed");
    return {
      json: {
        queue: (data ?? []).map((r) => ({
          id: r.id,
          triageLevelId: r.triage_level_id,
          status: r.status,
          submittedAt: r.submitted_at,
        })),
      },
    };
  },
});
