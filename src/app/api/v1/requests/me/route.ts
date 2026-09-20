import { route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

// FR-09: the student's own requests and statuses — the only channel for status.
// Deliberately status/metadata only: content of past requests never resurfaces here
// (FR-20, NFR-09), which also keeps cancelled-request content off every screen.
export const GET = route({
  access: ["student"],
  handler: async ({ caller }) => {
    const requests = await db()
      .from("request")
      .select("id, service_id, triage_level_id, status, submitted_at, service:service_id(name)")
      .eq("student_id", caller!.id)
      .order("submitted_at", { ascending: false });
    if (requests.error) throw new Error("read_failed");

    const appointments = await db()
      .from("appointment")
      .select("id, request_id, status, slot:slot_id(start_at)")
      .eq("student_id", caller!.id)
      .eq("status", "confirmed");
    if (appointments.error) throw new Error("read_failed");

    const byRequest = new Map(
      (appointments.data ?? []).map((a) => [
        a.request_id as string,
        { id: a.id as string, startAt: (a.slot as unknown as { start_at: string } | null)?.start_at ?? null },
      ]),
    );

    return {
      json: {
        requests: (requests.data ?? []).map((r) => ({
          id: r.id,
          serviceName: (r.service as unknown as { name: string } | null)?.name ?? "",
          triageLevelId: r.triage_level_id,
          status: r.status,
          submittedAt: r.submitted_at,
          bookable: r.status === "in_review" && r.triage_level_id !== 3,
          appointment: byRequest.get(r.id as string) ?? null,
        })),
      },
    };
  },
});
