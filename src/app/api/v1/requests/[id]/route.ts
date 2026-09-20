import { z } from "zod";
import { HttpError, notFound, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

// FR-12: practitioner moves a request of their own service to Escalated or Closed.
// `.strict()` rejects any content field — request content is never editable (PR-04, K-11).
const statusChange = z.object({ status: z.enum(["escalated", "closed"]) }).strict();

export const PATCH = route({
  access: ["practitioner"],
  body: statusChange,
  handler: async ({ params, body, caller }) => {
    const { data, error } = await db().rpc("update_request_status", {
      p_request: params.id,
      p_actor: caller!.id,
      p_new_status: body.status,
    });
    if (error) throw new Error("update_failed");
    if (data === "not_found") throw notFound();
    if (data === "invalid_transition") throw new HttpError(409, { error: "invalid_transition" });
    return { json: { id: params.id, status: body.status } };
  },
});
