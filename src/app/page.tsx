import { EmergencyBanner } from "@/components/EmergencyBanner";
import { ServiceFinder } from "@/components/ServiceFinder";

// FR-01, FR-02: browsable without signing in. The shell and the emergency banner are static;
// the catalogue loads client-side, so a data failure never takes the crisis path down (NFR-11).
export default function HomePage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Find the right support, privately</h1>
        <p className="mt-3 max-w-2xl text-slate-700">
          Browse what each service is for, what a first visit looks like, and exactly who will know. You only sign in
          when you decide to send a request — from flu shots to counselling, it all starts here.
        </p>
      </section>
      <EmergencyBanner />
      <ServiceFinder />
    </div>
  );
}
