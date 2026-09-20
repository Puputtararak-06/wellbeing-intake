import { z } from "zod";
import { route } from "@/lib/http";
import { suggest } from "@/lib/finder/suggest";

// FR-23 / BR-24: public, unauthenticated by design. The handler never reads cookies or
// tokens, so nothing sent to the model can be tied to a person. The typed text is never
// stored and never logged — only mode, outcome and latency are.
const input = z.object({ text: z.string().trim().min(2).max(300) }).strict();

export const POST = route({
  access: "public",
  body: input,
  handler: async ({ body, cid }) => {
    const started = Date.now();
    const result = await suggest(body.text);
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        svc: "wellbeing",
        kind: "finder",
        cid,
        mode: result.mode,
        reason: result.reason ?? null,
        matches: result.serviceIds.length,
        ms: Date.now() - started,
      }),
    );
    return { json: { mode: result.mode, serviceIds: result.serviceIds } };
  },
});
