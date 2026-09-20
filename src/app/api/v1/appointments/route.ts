import { z } from "zod";
import { HttpError, notFound, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";
import { dispatchInline } from "@/lib/events/dispatcher";
import { openSlotsForService } from "@/lib/slots";

const booking = z.object({ requestId: z.uuid(), slotId: z.uuid() }).strict();

// FR-16, FR-17: one atomic transaction (K-4). The storage layer decides a race (K-1/K-2).
export const POST = route({
  access: ["student"],
  body: booking,
  handler: async ({ body, caller, cid }) => {
    const { data, error } = await db().rpc("book_appointment", {
      p_student: caller!.id,
      p_request: body.requestId,
      p_slot: body.slotId,
    });
    if (error) throw new Error("booking_failed");
    const result = data as { code: string; appointment_id?: string; start_at?: string };

    if (result.code === "not_found") throw notFound();

    if (result.code === "request_not_bookable") {
      // BR-10: fixed, content-free reason code. The request is the caller's own.
      throw new HttpError(409, { error: "request_not_bookable" });
    }

    if (result.code === "slot_taken") {
      // FR-17: clear rejection plus refreshed availability.
      const req = await db().from("request").select("service_id").eq("id", body.requestId).maybeSingle();
      const slots = req.data ? await openSlotsForService(req.data.service_id) : [];
      throw new HttpError(409, { error: "slot_taken", slots });
    }

    // A reminder already inside its lead time is enqueued and attempted now; otherwise the
    // scheduled dispatcher picks it up. Never blocks or fails the booking (K-18).
    await dispatchInline(cid);

    return { status: 201, json: { id: result.appointment_id, startAt: result.start_at, status: "confirmed" } };
  },
});
