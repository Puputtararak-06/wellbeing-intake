import "server-only";
import { db } from "@/lib/supabase/admin";

export type OpenSlot = { id: string; startAt: string };

/** K-3: openness is derived — future-dated (server clock) AND no confirmed appointment. */
async function filterOpen(slots: { id: string; start_at: string }[]): Promise<OpenSlot[]> {
  if (slots.length === 0) return [];
  const taken = await db()
    .from("appointment")
    .select("slot_id")
    .in(
      "slot_id",
      slots.map((s) => s.id),
    )
    .eq("status", "confirmed");
  if (taken.error) throw new Error("read_failed");
  const takenIds = new Set((taken.data ?? []).map((t) => t.slot_id as string));
  return slots.filter((s) => !takenIds.has(s.id)).map((s) => ({ id: s.id, startAt: s.start_at }));
}

export async function openSlotsForPractitioners(practitionerIds: string[]): Promise<OpenSlot[]> {
  if (practitionerIds.length === 0) return [];
  const slots = await db()
    .from("slot")
    .select("id, start_at")
    .in("practitioner_id", practitionerIds)
    .gt("start_at", new Date().toISOString())
    .order("start_at");
  if (slots.error) throw new Error("read_failed");
  return filterOpen(slots.data ?? []);
}

export async function openSlotsForService(serviceId: string): Promise<OpenSlot[]> {
  const practitioners = await db()
    .from("app_user")
    .select("id")
    .eq("role", "practitioner")
    .eq("service_id", serviceId);
  if (practitioners.error) throw new Error("read_failed");
  return openSlotsForPractitioners((practitioners.data ?? []).map((p) => p.id as string));
}
