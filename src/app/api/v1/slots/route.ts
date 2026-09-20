import { z } from "zod";
import { HttpError, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

// FR-14: a practitioner's own schedule and manual slot publishing. No calendar sync (BR-12).
const newSlot = z.object({ startAt: z.iso.datetime({ offset: true }) }).strict();

export const GET = route({
  access: ["practitioner"],
  handler: async ({ caller }) => {
    const slots = await db()
      .from("slot")
      .select("id, start_at")
      .eq("practitioner_id", caller!.id)
      .gt("start_at", new Date().toISOString())
      .order("start_at");
    if (slots.error) throw new Error("read_failed");

    const ids = (slots.data ?? []).map((s) => s.id as string);
    const booked = new Set<string>();
    if (ids.length > 0) {
      const appts = await db().from("appointment").select("slot_id").in("slot_id", ids).eq("status", "confirmed");
      if (appts.error) throw new Error("read_failed");
      for (const a of appts.data ?? []) booked.add(a.slot_id as string);
    }
    return {
      json: {
        slots: (slots.data ?? []).map((s) => ({ id: s.id, startAt: s.start_at, booked: booked.has(s.id as string) })),
      },
    };
  },
});

export const POST = route({
  access: ["practitioner"],
  body: newSlot,
  handler: async ({ body, caller }) => {
    if (new Date(body.startAt).getTime() <= Date.now()) {
      throw new HttpError(400, { error: "validation_failed", fields: ["startAt"] });
    }
    const { data, error } = await db()
      .from("slot")
      .insert({ practitioner_id: caller!.id, start_at: body.startAt })
      .select("id, start_at")
      .single();
    if (error) {
      if (error.code === "23505") throw new HttpError(409, { error: "slot_exists" });
      throw new Error("insert_failed");
    }
    return { status: 201, json: { id: data.id, startAt: data.start_at, booked: false } };
  },
});
