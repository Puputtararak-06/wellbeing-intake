import { route } from "@/lib/http";
import { dispatch } from "@/lib/events/dispatcher";

// NFR-17: scoped machine credential only — not reachable with any user session.
// Called by the scheduled GitHub Actions job (which doubles as the database keep-alive),
// and by the demo trigger. Returns counts only.
export const POST = route({
  access: "machine",
  handler: async ({ cid }) => ({ json: await dispatch(cid) }),
});
