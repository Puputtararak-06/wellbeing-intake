"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, formatDateTime } from "@/lib/client/api";
import { ACUTE_LEVEL_ID, STATUS_SHORT, triageShort } from "@/lib/triage";

type QueueItem = { id: string; triageLevelId: number; status: string; submittedAt: string };
type Content = {
  id: string;
  structuredDescription: string;
  freeText: string | null;
  preferredTimes: string;
  triageLevelId: number;
  status: string;
};
type Slot = { id: string; startAt: string; booked: boolean };

export default function PractitionerPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [open, setOpen] = useState<Content | null>(null);
  const [newSlot, setNewSlot] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const q = await api<{ queue: QueueItem[] }>("/queue");
      if (!alive) return;
      if (q.status === 401 || q.status === 404) {
        router.replace("/sign-in?next=/practitioner");
        return;
      }
      const s = await api<{ slots: Slot[] }>("/slots");
      if (!alive) return;
      setQueue(q.data?.queue ?? []);
      setSlots(s.data?.slots ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [router, refreshKey]);

  // The audited read: each call is logged, and the first one moves the request to In review.
  async function openRequest(id: string) {
    setMessage(null);
    const r = await api<Content>(`/requests/${id}/content-views`, { method: "POST" });
    if (r.ok && r.data) {
      setOpen(r.data);
      load();
    } else {
      setMessage("That request is not available.");
    }
  }

  async function setStatus(id: string, status: "escalated" | "closed") {
    const r = await api(`/requests/${id}`, { method: "PATCH", body: { status } });
    setMessage(r.ok ? `Request marked ${status}.` : "That status change is not allowed.");
    setOpen(null);
    load();
  }

  async function publishSlot(e: React.FormEvent) {
    e.preventDefault();
    if (!newSlot) return;
    const r = await api("/slots", { method: "POST", body: { startAt: new Date(newSlot).toISOString() } });
    setMessage(
      r.ok ? "Slot published." : r.error === "slot_exists" ? "You already have a slot at that time." : "Please choose a future date and time.",
    );
    if (r.ok) setNewSlot("");
    load();
  }

  async function removeSlot(id: string) {
    const r = await api(`/slots/${id}`, { method: "DELETE" });
    setMessage(r.ok ? "Slot removed." : r.error === "slot_booked" ? "A booked slot cannot be removed." : "Could not remove that slot.");
    load();
  }

  if (!queue) return <p>Loading…</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold tracking-tight">My queue and schedule</h1>
      <div aria-live="polite">{message && <p className="rounded-md border border-teal-700 bg-teal-50 p-3">{message}</p>}</div>

      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading" className="text-xl font-semibold">
          Requests for my service
        </h2>
        <p className="text-sm text-slate-700">
          Most urgent first, then oldest first. This list shows no request content. Opening a request is logged every
          time.
        </p>
        {queue.length === 0 ? (
          <p className="mt-3 rounded-md border border-slate-200 bg-white p-4">No requests.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Requests for my service, most urgent first</caption>
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th scope="col" className="px-4 py-2">Urgency</th>
                  <th scope="col" className="px-4 py-2">Status</th>
                  <th scope="col" className="px-4 py-2">Submitted</th>
                  <th scope="col" className="px-4 py-2">Reference</th>
                  <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {queue.map((q) => (
                  <tr key={q.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 font-medium">
                      {q.triageLevelId === ACUTE_LEVEL_ID ? "▲ " : ""}
                      {triageShort(q.triageLevelId)}
                    </td>
                    <td className="px-4 py-2">{STATUS_SHORT[q.status] ?? q.status}</td>
                    <td className="px-4 py-2">{formatDateTime(q.submittedAt)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{q.id.slice(0, 8)}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => openRequest(q.id)} className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50">
                        Open<span className="sr-only"> request {q.id.slice(0, 8)}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <section aria-labelledby="open-heading" className="rounded-xl border-2 border-teal-800 bg-white p-5">
          <h2 id="open-heading" className="text-xl font-semibold">
            Request {open.id.slice(0, 8)} — {triageShort(open.triageLevelId)}
          </h2>
          <p className="text-sm text-slate-600">This view has been logged.</p>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="font-medium">What they would like help with</dt>
              <dd className="whitespace-pre-wrap">{open.structuredDescription}</dd>
            </div>
            {open.freeText && (
              <div>
                <dt className="font-medium">Anything else</dt>
                <dd className="whitespace-pre-wrap">{open.freeText}</dd>
              </div>
            )}
            <div>
              <dt className="font-medium">Preferred times</dt>
              <dd>{open.preferredTimes}</dd>
            </div>
          </dl>
          {open.triageLevelId === ACUTE_LEVEL_ID && (
            <p className="mt-3 rounded-md border border-rose-700 bg-rose-50 p-3 text-rose-950">
              Urgent self-assessment. Follow the crisis pathway outside this app, then record the handoff with “Mark
              escalated”. The student cannot book this request.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            {(open.status === "submitted" || open.status === "in_review") && (
              <>
                <button type="button" onClick={() => setStatus(open.id, "escalated")} className="rounded-md bg-rose-800 px-3 py-1.5 font-medium text-white hover:bg-rose-900">
                  Mark escalated
                </button>
                <button type="button" onClick={() => setStatus(open.id, "closed")} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
                  Close stale request
                </button>
              </>
            )}
            <button type="button" onClick={() => setOpen(null)} className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
              Hide
            </button>
          </div>
        </section>
      )}

      <section aria-labelledby="slots-heading">
        <h2 id="slots-heading" className="text-xl font-semibold">
          My availability
        </h2>
        <form onSubmit={publishSlot} className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="new-slot" className="block text-sm font-medium">
              New slot start
            </label>
            <input
              id="new-slot"
              type="datetime-local"
              value={newSlot}
              onChange={(e) => setNewSlot(e.target.value)}
              className="mt-1 rounded-md border border-slate-400 px-3 py-2"
            />
          </div>
          <button type="submit" className="rounded-md bg-teal-800 px-4 py-2 font-medium text-white hover:bg-teal-900">
            Publish slot
          </button>
        </form>
        <ul className="mt-4 space-y-2">
          {slots.length === 0 && <li className="text-sm text-slate-700">No upcoming slots.</li>}
          {slots.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-2">
              <span>
                {formatDateTime(s.startAt)} — <strong>{s.booked ? "Booked" : "Open"}</strong>
              </span>
              {!s.booked && (
                <button type="button" onClick={() => removeSlot(s.id)} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
                  Remove<span className="sr-only"> slot {formatDateTime(s.startAt)}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
