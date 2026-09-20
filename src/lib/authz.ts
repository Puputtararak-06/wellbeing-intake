import "server-only";
import { db } from "@/lib/supabase/admin";
import type { Identity } from "@/lib/identity/adapter";

export type Role = "student" | "practitioner" | "coordinator";

export type Caller = {
  id: string;
  role: Role;
  serviceId: string | null;
  displayName: string;
};

/**
 * Identity says who the person is and whether they are student or staff; the seed says
 * which staff member is a Practitioner of which service, or the Coordinator (BR-21, BR-26).
 * A verified staff identity with no seeded row gets no role at all.
 */
export async function resolveCaller(identity: Identity): Promise<Caller | null> {
  const found = await db()
    .from("app_user")
    .select("id, role, service_id, display_name")
    .eq("identity_ref", identity.identityRef)
    .maybeSingle();

  if (found.data) {
    return {
      id: found.data.id,
      role: found.data.role as Role,
      serviceId: found.data.service_id,
      displayName: found.data.display_name,
    };
  }

  if (identity.kind !== "student") return null;

  // First authentication of a student: persist only the required claims (FR-03, NFR-03).
  // Upsert on identity_ref so a first-login race yields one row (K-15).
  const created = await db()
    .from("app_user")
    .upsert(
      {
        identity_ref: identity.identityRef,
        email: identity.email,
        display_name: identity.displayName,
        role: "student",
      },
      { onConflict: "identity_ref", ignoreDuplicates: false },
    )
    .select("id, role, service_id, display_name")
    .single();

  if (created.error || !created.data) return null;
  return {
    id: created.data.id,
    role: created.data.role as Role,
    serviceId: created.data.service_id,
    displayName: created.data.display_name,
  };
}
