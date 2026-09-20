import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import { CORRELATION_HEADER, isUuid } from "@/lib/http";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, envelope, verify } from "@/lib/events/contract";

// Inbound webhook receiver: delivery receipts from the Notification Hub (Team 20).
// Signature is verified over the RAW body before anything is parsed; consumption is
// idempotent on eventId (platform PRD §4). Receipts carry only our opaque reference.
//
// Not wrapped by route(): it needs the raw body for verification.

const ACCEPTED_TYPES = new Set(["notification.delivered", "notification.failed"]);

function reply(status: number, json: unknown, cid: string) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", [CORRELATION_HEADER]: cid },
  });
}

export async function POST(req: Request): Promise<Response> {
  const cid = req.headers.get(CORRELATION_HEADER) ?? randomUUID();
  const log = (entry: Record<string, unknown>) =>
    console.log(JSON.stringify({ t: new Date().toISOString(), svc: "wellbeing", kind: "webhook_in", cid, ...entry }));

  const rawBody = await req.text();
  const verdict = verify(
    rawBody,
    req.headers.get(SIGNATURE_HEADER),
    req.headers.get(TIMESTAMP_HEADER),
    env.hubInboundSecret,
  );
  if (!verdict.ok) {
    log({ signature: "rejected", reason: verdict.reason, status: 401 });
    return reply(401, { error: "invalid_signature" }, cid);
  }

  let parsed;
  try {
    parsed = envelope.safeParse(JSON.parse(rawBody));
  } catch {
    parsed = null;
  }
  if (!parsed?.success || !ACCEPTED_TYPES.has(parsed.data.type)) {
    log({ signature: "verified", status: 400, outcome: "invalid_envelope" });
    return reply(400, { error: "invalid_envelope" }, cid);
  }

  const event = parsed.data;
  // A present-but-malformed reference is the sender's error (400), not ours: passing it on
  // to the uuid column would turn it into a permanent 500 that the sender retries forever.
  const rawReference = event.data.reference;
  if (rawReference !== undefined && rawReference !== null && !isUuid(rawReference)) {
    log({ signature: "verified", status: 400, outcome: "invalid_reference" });
    return reply(400, { error: "invalid_envelope" }, cid);
  }
  const reference = isUuid(rawReference) ? rawReference : null;

  const { data, error } = await db().rpc("record_inbound_event", {
    p_event: event.eventId,
    p_source: event.source,
    p_type: event.type,
    p_reference: reference,
    p_occurred: event.occurredAt,
  });
  if (error) {
    log({ signature: "verified", status: 500, eventId: event.eventId });
    return reply(500, { error: "internal_error" }, cid);
  }

  const firstTime = data === true;
  log({ signature: "verified", status: 200, eventId: event.eventId, type: event.type, duplicate: !firstTime });
  // A duplicate is acknowledged, not reprocessed — the sender can stop retrying.
  return reply(200, { received: true, duplicate: !firstTime }, cid);
}
