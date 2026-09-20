import { route } from "@/lib/http";
import { db } from "@/lib/supabase/admin";

// FR-01, FR-02: the only pre-login data call. Public catalogue only — nothing user-specific.
export const GET = route({
  access: "public",
  handler: async () => {
    const { data, error } = await db()
      .from("service")
      .select("id, slug, name, what_for, first_session, who_will_know")
      .order("name");
    if (error) throw new Error("catalogue_unavailable");
    return {
      json: {
        services: (data ?? []).map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          whatFor: s.what_for,
          firstSession: s.first_session,
          whoWillKnow: s.who_will_know,
        })),
      },
    };
  },
});
