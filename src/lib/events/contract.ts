import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Platform event envelope (platform PRD §4) and Team 16's two outbound types (PRD §11.5).
// This file has no server-only dependency so the contract can be unit-tested directly.

export const SOURCE = "wellbeing";
export const REMINDER_MESSAGE = "You have an appointment.";

// NFR-06: `.strict()` makes any field outside the allowlist a validation failure.
export const reminderData = z
  .object({
    appointmentAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
    message: z.literal(REMINDER_MESSAGE),
    reference: z.uuid(),
  })
  .strict();

export const cancelledData = z.object({ reference: z.uuid() }).strict();

export const dataSchemas = {
  "appointment.reminder": reminderData,
  "appointment.cancelled": cancelledData,
} as const;

export type OutboundType = keyof typeof dataSchemas;

export const envelope = z
  .object({
    eventId: z.uuid(),
    type: z.string().min(1),
    occurredAt: z.iso.datetime(),
    source: z.string().min(1),
    subject: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export type Envelope = z.infer<typeof envelope>;

export function buildEnvelope(row: {
  event_id: string;
  type: string;
  occurred_at: string;
  subject: string;
  payload: unknown;
}): Envelope {
  const schema = dataSchemas[row.type as OutboundType];
  if (!schema) throw new Error("unknown_event_type");
  // Validated again at send time: nothing over-full ever leaves (NFR-06).
  const data = schema.parse(row.payload);
  return {
    eventId: row.event_id,
    type: row.type,
    occurredAt: new Date(row.occurred_at).toISOString(),
    source: SOURCE,
    subject: row.subject,
    data,
  };
}

// --- Signing ---------------------------------------------------------------
// Assumption (NFR-17): HMAC-SHA256 over `${timestamp}.${rawBody}` with a shared secret,
// until Teams 20/23 fix the platform scheme. The timestamp bounds replay.

export const SIGNATURE_HEADER = "x-signature";
export const TIMESTAMP_HEADER = "x-signature-timestamp";
export const MAX_SKEW_SECONDS = 300;

export function sign(rawBody: string, timestamp: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

export function verify(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string,
  now: number = Date.now(),
): VerifyResult {
  if (!signature || !timestamp) return { ok: false, reason: "missing" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }
  const expected = Buffer.from(sign(rawBody, timestamp, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
