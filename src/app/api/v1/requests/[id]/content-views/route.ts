import { notFound, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

// FR-11 / K-13: the ONLY path that returns request content to anyone but its owner.
// It is a POST because every call creates an audit event (and the first one moves the
// request Submitted -> In review) — all inside one database transaction. If the audit
// insert fails, the read fails: there are no silent reads (BR-07).
export const POST = route({
  access: ["practitioner"],
  handler: async ({ params, caller }) => {
    const { data, error } = await db().rpc("read_request_content", {
      p_request: params.id,
      p_viewer: caller!.id,
    });
    if (error) throw new Error("audited_read_failed");
    if (!data) throw notFound(); // other service, or absent — indistinguishable (NFR-02)

    const r = data as {
      id: string;
      structured_description: string;
      free_text: string | null;
      preferred_times: string;
      triage_level_id: number;
      status: string;
      submitted_at: string;
    };
    return {
      status: 201,
      json: {
        id: r.id,
        structuredDescription: r.structured_description,
        freeText: r.free_text,
        preferredTimes: r.preferred_times,
        triageLevelId: r.triage_level_id,
        status: r.status,
        submittedAt: r.submitted_at,
      },
    };
  },
});
