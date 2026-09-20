import { notFound, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";
import { openSlotsForService } from "@/lib/slots";

// FR-15: open slots for the service handling the student's own In-review request.
// No practitioner names or ids are returned — only opaque slot ids and times.
export const GET = route({
  access: ["student"],
  handler: async ({ params, caller }) => {
    const req = await db()
      .from("request")
      .select("id, service_id, status, triage_level_id, student_id")
      .eq("id", params.id)
      .maybeSingle();
    const r = req.data;
    if (!r || r.student_id !== caller!.id || r.status !== "in_review" || r.triage_level_id === 3) {
      throw notFound();
    }
    return { json: { slots: await openSlotsForService(r.service_id) } };
  },
});
