"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { api, formatDateTime } from "@/lib/client/api";
import { ACUTE_LEVEL_ID, STATUS_LABELS, triageShort } from "@/lib/triage";

type MyRequest = {
  id: string;
  serviceName: string;
  triageLevelId: number;
  status: string;
  submittedAt: string;
  bookable: boolean;
  appointment: { id: string; startAt: string | null } | null;
};
type Slot = { id: string; startAt: string };

function MyRequests() {
  const router = useRouter();
  const justSent = useSearchParams().get("sent") === "1";
  const [requests, setRequests] = useState<MyRequest[] | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    api<{ requests: MyRequest[] }>("/requests/me").then((r) => {
      if (!alive) return;
      if (r.status === 401 || r.status === 404) router.replace("/sign-in?next=/requests");
      else setRequests(r.data?.requests ?? []);
    });
    return () => {
      alive = false;
    };
  }, [router, refreshKey]);

  async function showSlots(requestId: string) {
    setMessage(null);
    const r = await api<{ slots: Slot[] }>(`/requests/${requestId}/slots`);
    setSlots(r.data?.slots ?? []);
    setOpenFor(requestId);
  }

  async function book(requestId: string, slotId: string) {
    setBusy(true);
    const r = await api<{ slots?: Slot[] }>("/appointments", { method: "POST", body: { requestId, slotId } });
    setBusy(false);
    if (r.ok) {
      setOpenFor(null);
      setMessage("Your appointment is booked.");
      load();
    } else if (r.error === "slot_taken") {
      // FR-17: clear rejection plus refreshed availability
      setSlots(r.data?.slots ?? []);
      setMessage("Sorry — someone just took that time. Here are the times still open.");
    } else if (r.error === "request_not_bookable") {
      setOpenFor(null);
      setMessage("This request cannot be booked right now.");
      load();
    } else {
      setMessage("We could not book that time. Please try again.");
    }
  }

  async function cancel(appointmentId: string) {
    setBusy(true);
    const r = await api(`/appointments/${appointmentId}/cancel`, { method: "POST" });
    setBusy(false);
    setConfirmCancel(null);
    setMessage(r.ok ? "Your appointment is cancelled. No reason needed, no penalty." : "We could not cancel that appointment.");
    load();
  }

  if (!requests) return <p>Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">My requests</h1>
        <Link href="/" className="rounded-md bg-teal-800 px-4 py-2 font-medium text-white hover:bg-teal-900">
          New request
        </Link>
      </div>
      <p className="text-sm text-slate-700">
        Status only ever appears here — we never email or text it. What you wrote in a request is not shown again on
        this page.
      </p>

      <div aria-live="polite">
        {(message || justSent) && (
          <p className="rounded-md border border-teal-700 bg-teal-50 p-3">
            {message ?? "Your request was sent privately. You can book a time once a practitioner has opened it."}
          </p>
        )}
      </div>

      {requests.length === 0 && <p className="rounded-md border border-slate-200 bg-white p-4">You have no requests yet.</p>}

      <ul className="space-y-4">
        {requests.map((r) => (
          <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{r.serviceName}</h2>
              <p className="text-sm text-slate-600">Sent {formatDateTime(r.submittedAt)}</p>
            </div>
            <p className="mt-1">
              <span className="font-medium">Status:</span> {STATUS_LABELS[r.status] ?? r.status}
            </p>
            <p className="text-sm text-slate-700">Urgency you chose: {triageShort(r.triageLevelId)}</p>

            {r.triageLevelId === ACUTE_LEVEL_ID && r.status !== "closed" && (
              <p className="mt-3 rounded-md border border-rose-700 bg-rose-50 p-3 text-rose-950">
                Staff follow urgent requests up directly — this one is not booked through the app. If you need help
                now, please use the{" "}
                <Link className="font-semibold underline" href="/emergency">
                  emergency contacts
                </Link>
                .
              </p>
            )}

            {r.appointment && (
              <div className="mt-3 rounded-md border border-slate-300 p-3">
                <p>
                  <span className="font-medium">Appointment:</span>{" "}
                  {r.appointment.startAt ? formatDateTime(r.appointment.startAt) : "confirmed"}
                </p>
                {confirmCancel === r.appointment.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span>Cancel this appointment?</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => cancel(r.appointment!.id)}
                      className="rounded-md bg-rose-800 px-3 py-1.5 font-medium text-white hover:bg-rose-900 disabled:opacity-60"
                    >
                      Yes, cancel it
                    </button>
                    <button type="button" onClick={() => setConfirmCancel(null)} className="rounded-md border border-slate-300 px-3 py-1.5">
                      Keep it
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(r.appointment!.id)}
                    className="mt-2 rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
                  >
                    Cancel appointment
                  </button>
                )}
              </div>
            )}

            {r.bookable && !r.appointment && (
              <div className="mt-3">
                {openFor === r.id ? (
                  <div>
                    <p className="font-medium">Choose a time</p>
                    {slots.length === 0 ? (
                      <p className="text-sm text-slate-700">No open times at the moment. Please check back later.</p>
                    ) : (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {slots.map((s) => (
                          <li key={s.id}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => book(r.id, s.id)}
                              className="rounded-md border border-teal-800 px-3 py-1.5 text-teal-900 hover:bg-teal-50 disabled:opacity-60"
                            >
                              {formatDateTime(s.startAt)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => showSlots(r.id)}
                    className="rounded-md bg-teal-800 px-4 py-2 font-medium text-white hover:bg-teal-900"
                  >
                    Book a time
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MyRequestsPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <MyRequests />
    </Suspense>
  );
}
