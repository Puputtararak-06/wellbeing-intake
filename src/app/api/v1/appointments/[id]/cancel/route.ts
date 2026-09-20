import { notFound, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";
import { dispatchInline } from "@/lib/events/dispatcher";

// FR-19: one confirmation action, no justification, no body. A state change, not a delete
// (K-5): the slot reopens immediately because openness is derived (K-3). If a reminder had
// already gone out, the same transaction writes the retraction (BR-25).
export const POST = route({
  access: ["student"],
  handler: async ({ params, caller, cid }) => {
    const { data, error } = await db().rpc("cancel_appointment", {
      p_student: caller!.id,
      p_appointment: params.id,
    });
    if (error) throw new Error("cancel_failed");
    const result = data as { code: string; retraction_enqueued?: boolean };
    if (result.code !== "ok") throw notFound();

    if (result.retraction_enqueued) await dispatchInline(cid);
    return { json: { id: params.id, status: "cancelled" } };
  },
});
