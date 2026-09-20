import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { CORRELATION_HEADER, machineAuthorized } from "@/lib/http";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, dataSchemas, envelope, verify, type OutboundType } from "@/lib/events/contract";

// Contract mock of the Notification Hub (C-07): a stand-in for Team 20's endpoint that
// verifies the signature and the envelope over REAL HTTP — so "mock the consumer" exercises
// the true delivery path. Enabled only when MOCK_HUB_ENABLED=true; 404 otherwise.
//
// PUT toggles an outage, for the degradation rehearsal:  { "fail": true | false }
// (requires `Authorization: Bearer <DISPATCH_TOKEN>`)

const state = globalThis as unknown as { __mockHubFail?: boolean };

function reply(status: number, json: unknown, cid: string) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", [CORRELATION_HEADER]: cid },
  });
}

export async function POST(req: Request): Promise<Response> {
  const cid = req.headers.get(CORRELATION_HEADER) ?? randomUUID();
  if (!env.mockHubEnabled) return reply(404, { error: "not_found" }, cid);
  if (state.__mockHubFail) return reply(503, { error: "mock_hub_outage" }, cid);

  const rawBody = await req.text();
  const verdict = verify(rawBody, req.headers.get(SIGNATURE_HEADER), req.headers.get(TIMESTAMP_HEADER), env.hubSigningSecret);
  if (!verdict.ok) return reply(401, { error: "invalid_signature", reason: verdict.reason }, cid);

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return reply(400, { error: "invalid_json" }, cid);
  }
  const parsed = envelope.safeParse(body);
  if (!parsed.success) return reply(400, { error: "invalid_envelope" }, cid);

  const schema = dataSchemas[parsed.data.type as OutboundType];
  if (!schema || !schema.safeParse(parsed.data.data).success) {
    return reply(422, { error: "data_outside_contract" }, cid);
  }

  console.log(
    JSON.stringify({ t: new Date().toISOString(), svc: "mock-hub", cid, eventId: parsed.data.eventId, type: parsed.data.type, accepted: true }),
  );
  return reply(202, { accepted: true, eventId: parsed.data.eventId }, cid);
}

export async function PUT(req: Request): Promise<Response> {
  const cid = req.headers.get(CORRELATION_HEADER) ?? randomUUID();
  if (!env.mockHubEnabled) return reply(404, { error: "not_found" }, cid);
  // The outage switch is an operator action: it needs the machine credential, not anonymity.
  if (!machineAuthorized(req)) return reply(401, { error: "unauthenticated" }, cid);
  const body = (await req.json().catch(() => ({}))) as { fail?: boolean };
  state.__mockHubFail = body.fail === true;
  return reply(200, { fail: state.__mockHubFail }, cid);
}
