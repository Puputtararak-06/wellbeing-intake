import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const BASE = "http://localhost:3000/api/v1";
export const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-16";

export const USERS = {
  studentA: "student.a@demo.test",
  studentB: "student.b@demo.test",
  studentC: "student.c@demo.test",
  counsellor1: "counsellor.1@demo.test",
  counsellor2: "counsellor.2@demo.test",
  nurse: "nurse.1@demo.test",
  coordinator: "coordinator@demo.test",
} as const;

/** Service-role client — for arranging fixtures and asserting on stored state only. */
export const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** What a browser holds: the anon key and nothing else. */
export const anon = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const tokens = new Map<string, string>();

export async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const { data, error } = await anon().auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  tokens.set(email, data.session.access_token);
  return data.session.access_token;
}

type Handler = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;

export type CallResult = { status: number; text: string; json: Record<string, unknown>; headers: Headers };

export async function call(
  handler: Handler,
  opts: {
    method?: string;
    path: string;
    as?: string;
    body?: unknown;
    params?: Record<string, string>;
    headers?: Record<string, string>;
  },
): Promise<CallResult> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.as) headers.authorization = `Bearer ${await tokenFor(opts.as)}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${BASE}${opts.path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    // leave empty
  }
  return { status: res.status, text, json, headers: res.headers };
}

export async function serviceId(slug: string): Promise<string> {
  const { data, error } = await admin.from("service").select("id").eq("slug", slug).single();
  if (error) throw error;
  return data.id as string;
}

export async function userId(email: string): Promise<string> {
  const { data, error } = await admin.from("app_user").select("id").eq("email", email).single();
  if (error) throw error;
  return data.id as string;
}

let slotCounter = 0;

/** A fresh, unique future slot. Default is far outside the 24 h reminder lead time. */
export async function makeSlot(practitionerEmail: string, hoursAhead = 24 * 20): Promise<string> {
  slotCounter++;
  const startAt = new Date(Date.now() + hoursAhead * 3_600_000 + slotCounter * 60_000 + Math.floor(Math.random() * 50_000));
  const { data, error } = await admin
    .from("slot")
    .insert({ practitioner_id: await userId(practitionerEmail), start_at: startAt.toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export function requestBody(service: string, overrides: Record<string, unknown> = {}) {
  return {
    serviceId: service,
    structuredDescription: "demo description",
    preferredTimes: "weekday afternoons",
    triageLevelId: 1,
    submissionKey: randomUUID(),
    ...overrides,
  };
}

/** Captures everything written to console.log while `fn` runs (for the NFR-07 sentinel test). */
export async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const lines: string[] = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  const sink = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.log = sink;
  console.error = sink;
  console.warn = sink;
  try {
    const result = await fn();
    return { result, logs: lines.join("\n") };
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
  }
}
