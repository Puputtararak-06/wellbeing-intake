import { notFound, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";
import { openSlotsForPractitioners } from "@/lib/slots";

// FR-15 (mandated endpoint): open slots of one practitioner.
//   Practitioner — own schedule only.
//   Student — only if they own an In-review, non-acute request for that practitioner's service.
// Anything else is the identical 404 (NFR-02).
export const GET = route({
  access: ["student", "practitioner"],
  handler: async ({ params, caller }) => {
    const target = await db()
      .from("app_user")
      .select("id, role, service_id")
      .eq("id", params.id)
      .maybeSingle();
    if (!target.data || target.data.role !== "practitioner") throw notFound();

    if (caller!.role === "practitioner") {
      if (caller!.id !== params.id) throw notFound();
    } else {
      const eligible = await db()
        .from("request")
        .select("id", { count: "exact", head: true })
        .eq("student_id", caller!.id)
        .eq("service_id", target.data.service_id)
        .eq("status", "in_review")
        .neq("triage_level_id", 3);
      if (eligible.error || !eligible.count) throw notFound();
    }

    return { json: { slots: await openSlotsForPractitioners([params.id]) } };
  },
});
