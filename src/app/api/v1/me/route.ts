import { route } from "@/lib/http";

// Lets the UI decide which screen to show. UI checks are cosmetic; FR-21 lives server-side.
export const GET = route({
  access: ["student", "practitioner", "coordinator"],
  handler: async ({ caller }) => ({
    json: { id: caller!.id, role: caller!.role, displayName: caller!.displayName },
  }),
});
