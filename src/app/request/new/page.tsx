import { Suspense } from "react";
import { EmergencyBanner } from "@/components/EmergencyBanner";
import { RequestForm } from "@/components/RequestForm";

// FR-07: the emergency banner is a static server component rendered above the form, so it is
// visible without scrolling and does not depend on any data loading.
export default function NewRequestPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Send a private request</h1>
      <EmergencyBanner />
      <Suspense fallback={<p>Loading…</p>}>
        <RequestForm />
      </Suspense>
    </div>
  );
}
