"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

type Me = { role: "student" | "practitioner" | "coordinator"; displayName: string };

const HOME: Record<Me["role"], { href: string; label: string }> = {
  student: { href: "/requests", label: "My requests" },
  practitioner: { href: "/practitioner", label: "My queue" },
  coordinator: { href: "/coordinator", label: "Overview" },
};

export function SiteHeader() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let alive = true;
    api<Me>("/me").then((r) => {
      if (alive) setMe(r.ok ? r.data : null);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function signOut() {
    await api("/session", { method: "DELETE" });
    setMe(null);
    // replace() so Back cannot return to a signed-in screen (NFR-08)
    router.replace("/");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-teal-900">
          Campus Health &amp; Wellbeing
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-4 text-sm">
          <Link className="underline-offset-4 hover:underline" href="/">
            Services
          </Link>
          <Link className="underline-offset-4 hover:underline" href="/emergency">
            Emergency contacts
          </Link>
          {me ? (
            <>
              <Link className="underline-offset-4 hover:underline" href={HOME[me.role].href}>
                {HOME[me.role].label}
              </Link>
              <button type="button" onClick={signOut} className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50">
                Sign out
              </button>
            </>
          ) : (
            <Link className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50" href="/sign-in">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
