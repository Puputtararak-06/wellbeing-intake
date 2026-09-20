import type { Metadata } from "next";
import { CANNOT_HELP_NOW, EMERGENCY_CONTACTS } from "@/lib/emergency";

// FR-07 / NFR-11: fully static. No data fetch, no sign-in, no feature flag.
export const dynamic = "force-static";

export const metadata: Metadata = { title: "Emergency contacts" };

export default function EmergencyPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Emergency contacts</h1>
      <p className="max-w-2xl rounded-xl border-2 border-rose-700 bg-rose-50 p-5 text-rose-950">{CANNOT_HELP_NOW}</p>
      <ul className="space-y-3">
        {EMERGENCY_CONTACTS.map((c) => (
          <li key={c.tel} className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="font-semibold">{c.name}</p>
            <p className="text-sm text-slate-700">{c.detail}</p>
            <a className="mt-1 inline-block text-2xl font-bold text-teal-900 underline underline-offset-4" href={`tel:${c.tel}`}>
              {c.phone}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
