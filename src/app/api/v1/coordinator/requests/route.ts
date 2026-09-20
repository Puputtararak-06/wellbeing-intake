import { route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

// FR-13 / PR-03: operational metadata across all services, acute-flagged first.
// The SELECT never names description, free text, or preferred times.
export const GET = route({
  access: ["coordinator"],
  handler: async () => {
    const requests = await db()
      .from("request")
      .select("id, triage_level_id, status, submitted_at, service:service_id(name)")
      .order("triage_level_id", { ascending: false })
      .order("submitted_at", { ascending: true });
    if (requests.error) throw new Error("read_failed");

    const ids = (requests.data ?? []).map((r) => r.id as string);
    const lastChange = new Map<string, string>();
    if (ids.length > 0) {
      // Only the latest change timestamp is derived from the history — never who, never content.
      const changes = await db()
        .from("request_status_change")
        .select("request_id, changed_at")
        .in("request_id", ids)
        .order("changed_at", { ascending: false });
      if (changes.error) throw new Error("read_failed");
      for (const c of changes.data ?? []) {
        if (!lastChange.has(c.request_id as string)) lastChange.set(c.request_id as string, c.changed_at as string);
      }
    }

    return {
      json: {
        requests: (requests.data ?? []).map((r) => ({
          id: r.id,
          serviceName: (r.service as unknown as { name: string } | null)?.name ?? "",
          triageLevelId: r.triage_level_id,
          acute: r.triage_level_id === 3,
          status: r.status,
          submittedAt: r.submitted_at,
          lastStatusChangeAt: lastChange.get(r.id as string) ?? r.submitted_at,
        })),
      },
    };
  },
});
