"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/client/api";

type Service = { id: string; slug: string; name: string; whatFor: string; firstSession: string; whoWillKnow: string };
type Suggestion = { mode: "ai" | "fallback"; serviceIds: string[] };

export function ServiceFinder() {
  const [services, setServices] = useState<Service[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // FR-23 helper state. Nothing here is written to browser storage.
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [helperError, setHelperError] = useState(false);
  const helpId = useId();

  useEffect(() => {
    let alive = true;
    api<{ services: Service[] }>("/services").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setServices(r.data.services);
      else setLoadError(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function onSuggest(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 2) return;
    setBusy(true);
    setHelperError(false);
    const r = await api<Suggestion>("/finder/suggest", { method: "POST", body: { text } });
    setBusy(false);
    if (r.ok && r.data) setSuggestion(r.data);
    else setHelperError(true);
  }

  const suggested = suggestion && services ? suggestion.serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean) as Service[] : [];

  return (
    <div className="space-y-8">
      <section aria-labelledby="helper-heading" className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 id="helper-heading" className="text-xl font-semibold">
          Not sure which service? Help me choose
        </h2>
        <p id={helpId} className="mt-2 text-sm text-slate-700">
          Optional. Type a few words and we will point you to services from the list below. What you type is sent to an
          AI matching service when it is available, is <strong>not stored</strong>, and is{" "}
          <strong>not linked to you</strong> — you are not signed in. This helper{" "}
          <strong>cannot judge how urgent something is</strong>; if you need help now, use the emergency contacts
          above. You can always skip it and browse the full list.
        </p>
        <form onSubmit={onSuggest} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <label htmlFor="helper-text" className="sr-only">
            What are you looking for?
          </label>
          <input
            id="helper-text"
            aria-describedby={helpId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            autoComplete="off"
            placeholder="e.g. trouble sleeping before exams"
            className="w-full rounded-md border border-slate-400 bg-white px-3 py-2"
          />
          <button
            type="submit"
            disabled={busy || text.trim().length < 2}
            className="rounded-md bg-teal-800 px-4 py-2 font-medium text-white hover:bg-teal-900 disabled:opacity-60"
          >
            {busy ? "Looking…" : "Suggest services"}
          </button>
        </form>

        <div aria-live="polite" className="mt-4">
          {helperError && (
            <p className="text-sm text-slate-700">The helper is unavailable right now. The full list below still works.</p>
          )}
          {suggestion && !helperError && (
            <div>
              {suggested.length > 0 ? (
                <>
                  <p className="text-sm font-medium">
                    These might fit ({suggestion.mode === "ai" ? "AI match" : "keyword match"}):
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {suggested.map((s) => (
                      <li key={s.id}>
                        <a href={`#service-${s.slug}`} className="inline-block rounded-full border border-teal-700 px-3 py-1 text-sm text-teal-900 underline-offset-2 hover:underline">
                          {s.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-slate-700">
                  No clear match — that is fine. Have a look through the full list below, or ask at the counselling
                  front desk.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="services-heading">
        <h2 id="services-heading" className="text-xl font-semibold">
          All services
        </h2>
        {loadError && (
          <p role="alert" className="mt-3 rounded-md border border-slate-300 bg-white p-4">
            We could not load the services just now. Please try again in a moment. The emergency contacts above are
            always available.
          </p>
        )}
        {!services && !loadError && <p className="mt-3 text-slate-600">Loading services…</p>}
        {services && (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {services.map((s) => (
              <li key={s.id} id={`service-${s.slug}`} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-lg font-semibold">{s.name}</h3>
                <dl className="mt-3 space-y-3 text-sm">
                  <div>
                    <dt className="font-medium text-slate-900">What it is for</dt>
                    <dd className="text-slate-700">{s.whatFor}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">What a first visit looks like</dt>
                    <dd className="text-slate-700">{s.firstSession}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-900">Who will know</dt>
                    <dd className="text-slate-700">{s.whoWillKnow}</dd>
                  </div>
                </dl>
                <Link
                  href={`/request/new?service=${s.id}`}
                  className="mt-4 inline-block self-start rounded-md bg-teal-800 px-4 py-2 font-medium text-white hover:bg-teal-900"
                >
                  Request {s.name.toLowerCase()}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
