import { z } from "zod";
import { HttpError, notFound, route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

// FR-05, FR-06: exactly these fields and no others (`.strict()` enforces the NFR-03 allowlist).
const newRequest = z
  .object({
    serviceId: z.uuid(),
    structuredDescription: z.string().trim().min(1).max(500),
    freeText: z.string().trim().max(2000).optional(),
    preferredTimes: z.string().trim().min(1).max(300),
    triageLevelId: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    submissionKey: z.uuid(),
  })
  .strict();

export const POST = route({
  access: ["student"],
  body: newRequest,
  handler: async ({ body, caller }) => {
    const service = await db().from("service").select("id").eq("id", body.serviceId).maybeSingle();
    if (!service.data) throw new HttpError(400, { error: "validation_failed", fields: ["serviceId"] });

    const { data, error } = await db().rpc("create_request", {
      p_student: caller!.id,
      p_service: body.serviceId,
      p_description: body.structuredDescription,
      p_free_text: body.freeText ?? "",
      p_preferred: body.preferredTimes,
      p_triage: body.triageLevelId,
      p_submission_key: body.submissionKey,
    });
    if (error) throw new Error("create_failed");

    const result = data as {
      code: string;
      created?: boolean;
      id?: string;
      status?: string;
      triage_level_id?: number;
      submitted_at?: string;
    };
    if (result.code !== "ok") throw notFound();

    // K-17: a replayed submission_key returns the existing request — not an error, not a duplicate.
    return {
      status: result.created ? 201 : 200,
      json: {
        id: result.id,
        status: result.status,
        triageLevelId: result.triage_level_id,
        submittedAt: result.submitted_at,
        created: result.created,
        // FR-08: the client foregrounds emergency contacts and withholds the booking flow.
        acute: result.triage_level_id === 3,
      },
    };
  },
});
