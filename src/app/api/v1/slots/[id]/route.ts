import { HttpError, notFound, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

// FR-14 / K-7: removal only while unbooked, checked atomically inside the database.
export const DELETE = route({
  access: ["practitioner"],
  handler: async ({ params, caller }) => {
    const { data, error } = await db().rpc("remove_slot", { p_practitioner: caller!.id, p_slot: params.id });
    if (error) throw new Error("remove_failed");
    if (data === "not_found") throw notFound();
    if (data === "booked") throw new HttpError(409, { error: "slot_booked" });
    return { json: { ok: true } };
  },
});
