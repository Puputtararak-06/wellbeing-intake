import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as createRequest } from "@/app/api/v1/requests/route";
import { POST as viewContent } from "@/app/api/v1/requests/[id]/content-views/route";
import { POST as book } from "@/app/api/v1/appointments/route";
import { POST as cancel } from "@/app/api/v1/appointments/[id]/cancel/route";
import { DELETE as removeSlot } from "@/app/api/v1/slots/[id]/route";
import { POST as dispatchRoute } from "@/app/api/v1/internal/events/dispatch/route";
import { POST as inboundWebhook } from "@/app/api/v1/webhooks/notification-hub/route";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from "@/lib/events/contract";
import { BASE, USERS, admin, call, makeSlot, requestBody, serviceId } from "./helpers";

// A real HTTP receiver standing in for Team 20: deliveries cross an actual socket.
type Received = { headers: Record<string, string | string[] | undefined>; raw: string; body: Record<string, unknown> };
let server: Server;
let received: Received[] = [];
let failNext = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (failNext > 0) {
        failNext--;
        res.writeHead(503).end("{}");
        return;
      }
      received.push({ headers: req.headers, raw, body: JSON.parse(raw) });
      res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.HUB_WEBHOOK_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hub`;
});

afterAll(async () => {
  process.env.HUB_WEBHOOK_URL = "";
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received = [];
  failNext = 0;
});

const runDispatch = () =>
  call(dispatchRoute, { method: "POST", path: "/internal/events/dispatch", headers: { authorization: `Bearer ${process.env.DISPATCH_TOKEN}` } });

async function bookedAppointment(student: string, hoursAhead: number) {
  const counselling = await serviceId("counselling");
  const created = await call(createRequest, { method: "POST", path: "/requests", as: student, body: requestBody(counselling, { structuredDescription: "event-sentinel" }) });
  const id = created.json.id as string;
  await call(viewContent, { method: "POST", path: `/requests/${id}/content-views`, as: USERS.counsellor1, params: { id } });
  const slot = await makeSlot(USERS.counsellor1, hoursAhead);
  const booked = await call(book, { method: "POST", path: "/appointments", as: student, body: { requestId: id, slotId: slot } });
  expect(booked.status).toBe(201);
  return { appointment: booked.json.id as string, slot };
}

const outbox = (reference: string) => admin.from("outbound_event").select("*").eq("reference", reference).order("occurred_at");

describe("Reminder (FR-18, NFR-06, NFR-17, BR-16, K-14, K-18, K-19)", () => {
  it("delivers exactly one signed, metadata-only reminder in the platform envelope", async () => {
    const { appointment } = await bookedAppointment(USERS.studentA, 3); // inside the 24 h lead time
    await runDispatch();
    await runDispatch(); // a second run must not produce a second reminder

    const mine = received.filter((r) => (r.body.data as { reference: string }).reference === appointment);
    expect(mine).toHaveLength(1);
    const { body, raw, headers } = mine[0];

    expect(Object.keys(body).sort()).toEqual(["data", "eventId", "occurredAt", "source", "subject", "type"]);
    expect(body.type).toBe("appointment.reminder");
    expect(body.source).toBe("wellbeing");
    expect(String(body.subject)).toMatch(/^student:.+/); // the Hub needs to know whom to notify
    expect(Object.keys(body.data as object).sort()).toEqual(["appointmentAt", "message", "reference"]);
    expect((body.data as { message: string }).message).toBe("You have an appointment.");
    expect(raw).not.toMatch(/counsell|event-sentinel|triage|practitioner|Demo Counsellor/i);

    const verdict = verify(raw, String(headers[SIGNATURE_HEADER]), String(headers[TIMESTAMP_HEADER]), process.env.HUB_SIGNING_SECRET!);
    expect(verdict).toEqual({ ok: true });
    expect(headers["x-correlation-id"]).toBeTruthy();

    // K-19: once delivered, the recipient and payload are gone from the outbox
    const rows = await outbox(appointment);
    expect(rows.data).toHaveLength(1);
    expect(rows.data![0].delivered_at).not.toBeNull();
    expect(rows.data![0].subject).toBeNull();
    expect(rows.data![0].payload).toBeNull();
  });

  it("does not remind for an appointment outside the lead time", async () => {
    const { appointment } = await bookedAppointment(USERS.studentB, 24 * 15);
    await runDispatch();
    expect((await outbox(appointment)).data).toHaveLength(0);
  });

  it("retries a failed delivery with the SAME eventId and a growing backoff, then succeeds", async () => {
    failNext = 99;
    const { appointment } = await bookedAppointment(USERS.studentA, 4);
    await runDispatch();

    let row = (await outbox(appointment)).data![0];
    expect(row.delivered_at).toBeNull();
    const eventId = row.event_id;
    const firstAttempts = row.attempts as number;
    expect(firstAttempts).toBeGreaterThanOrEqual(1);
    const firstDelay = new Date(row.next_attempt_at).getTime() - Date.now();
    expect(firstDelay).toBeGreaterThan(0);

    // make it due again, fail again: the interval must grow
    await admin.from("outbound_event").update({ next_attempt_at: new Date().toISOString() }).eq("event_id", eventId);
    await runDispatch();
    row = (await outbox(appointment)).data![0];
    expect(row.attempts).toBe(firstAttempts + 1);
    const secondDelay = new Date(row.next_attempt_at).getTime() - Date.now();
    expect(secondDelay).toBeGreaterThan(firstDelay);

    // dependency recovers
    failNext = 0;
    await admin.from("outbound_event").update({ next_attempt_at: new Date().toISOString(), failed_at: null }).eq("event_id", eventId);
    await runDispatch();
    const delivered = received.filter((r) => r.body.eventId === eventId);
    expect(delivered).toHaveLength(1);
    row = (await outbox(appointment)).data![0];
    expect(row.delivered_at).not.toBeNull();
  });

  it("parks the event after the attempt cap without touching the appointment", async () => {
    failNext = 99;
    const { appointment } = await bookedAppointment(USERS.studentB, 5);
    for (let i = 0; i < 4; i++) {
      await admin.from("outbound_event").update({ next_attempt_at: new Date().toISOString() }).eq("reference", appointment);
      await runDispatch();
    }
    const row = (await outbox(appointment)).data![0];
    expect(row.failed_at).not.toBeNull();
    const appt = await admin.from("appointment").select("status").eq("id", appointment).single();
    expect(appt.data!.status).toBe("confirmed");
  });

  it("the storage layer itself refuses an over-full payload (NFR-06, second line of defence)", async () => {
    const reference = randomUUID();
    const { error } = await admin.from("outbound_event").insert({
      type: "appointment.reminder",
      reference,
      subject: "student:x",
      payload: { appointmentAt: "2026-10-06T02:00:00Z", message: "You have an appointment.", reference, serviceName: "Counselling" },
    });
    expect(error).not.toBeNull();
  });

  it("the dispatcher accepts only the machine credential", async () => {
    const none = await call(dispatchRoute, { method: "POST", path: "/internal/events/dispatch" });
    const user = await call(dispatchRoute, { method: "POST", path: "/internal/events/dispatch", as: USERS.coordinator });
    const wrong = await call(dispatchRoute, { method: "POST", path: "/internal/events/dispatch", headers: { authorization: "Bearer nope" } });
    for (const r of [none, user, wrong]) expect(r.status).toBe(401);
  });
});

describe("Retraction (BR-25, K-18, K-20)", () => {
  it("cancelling BEFORE the reminder is published means no reminder is ever sent", async () => {
    const { appointment, slot } = await bookedAppointment(USERS.studentC, 24 * 15);
    await call(cancel, { method: "POST", path: `/appointments/${appointment}/cancel`, as: USERS.studentC, params: { id: appointment } });
    // even once the slot falls inside the lead time, a cancelled appointment is never reminded
    await admin.from("slot").update({ start_at: new Date(Date.now() + 2 * 3_600_000 + 7_000).toISOString() }).eq("id", slot);
    await runDispatch();
    const rows = await outbox(appointment);
    expect(rows.data).toHaveLength(0);
  });

  it("a reminder still waiting to retry when its appointment is cancelled is never delivered later", async () => {
    failNext = 1; // the inline attempt at booking fails, so the reminder sits in the outbox backing off
    const { appointment } = await bookedAppointment(USERS.studentC, 7);
    let rows = await outbox(appointment);
    expect(rows.data![0].delivered_at).toBeNull();

    await call(cancel, { method: "POST", path: `/appointments/${appointment}/cancel`, as: USERS.studentC, params: { id: appointment } });

    // Hub is healthy again and every row is made due: the stale reminder must still never go out.
    await admin.from("outbound_event").update({ next_attempt_at: new Date().toISOString() }).eq("reference", appointment).is("delivered_at", null);
    await runDispatch();
    await runDispatch();

    const forThis = received.filter((r) => (r.body.data as { reference: string }).reference === appointment);
    expect(forThis.filter((r) => r.body.type === "appointment.reminder")).toHaveLength(0);
    expect(forThis.filter((r) => r.body.type === "appointment.cancelled")).toHaveLength(1);

    rows = await outbox(appointment);
    const reminder = rows.data!.find((r) => r.type === "appointment.reminder")!;
    expect(reminder.delivered_at).toBeNull();
    expect(reminder.failed_at).not.toBeNull(); // parked by the cancellation itself
    expect(reminder.subject).toBeNull();
    expect(reminder.payload).toBeNull();
  });

  it("cancelling AFTER the reminder sends exactly one content-free retraction; the slot can then be removed", async () => {
    const { appointment, slot } = await bookedAppointment(USERS.studentC, 6);
    await runDispatch(); // reminder goes out
    received = [];

    await call(cancel, { method: "POST", path: `/appointments/${appointment}/cancel`, as: USERS.studentC, params: { id: appointment } });
    await runDispatch();

    const retractions = received.filter((r) => r.body.type === "appointment.cancelled" && (r.body.data as { reference: string }).reference === appointment);
    expect(retractions).toHaveLength(1);
    expect(Object.keys(retractions[0].body.data as object)).toEqual(["reference"]);

    // K-20: outbox rows hold the reference by value, so slot removal is not blocked
    const removed = await call(removeSlot, { method: "DELETE", path: `/slots/${slot}`, as: USERS.counsellor1, params: { id: slot } });
    expect(removed.status).toBe(200);
    const rows = await outbox(appointment);
    expect(rows.data!.map((r) => r.type).sort()).toEqual(["appointment.cancelled", "appointment.reminder"]);
  });
});

describe("Inbound webhook receiver (signature + idempotency on eventId)", () => {
  function signedRequest(body: Record<string, unknown>, opts: { secret?: string; tamper?: boolean } = {}) {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    return new Request(`${BASE}/webhooks/notification-hub`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: sign(raw, ts, opts.secret ?? process.env.HUB_INBOUND_SECRET!),
        [TIMESTAMP_HEADER]: ts,
      },
      body: opts.tamper ? raw.replace("notification.delivered", "notification.failed") : raw,
    });
  }

  const receipt = () => ({
    eventId: randomUUID(),
    type: "notification.delivered",
    occurredAt: new Date().toISOString(),
    source: "notification-hub",
    subject: "reference:" + randomUUID(),
    data: { reference: randomUUID() },
  });

  it("accepts a correctly signed receipt and stores it", async () => {
    const body = receipt();
    const res = await inboundWebhook(signedRequest(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: false });
    const { count } = await admin.from("inbound_event").select("event_id", { count: "exact", head: true }).eq("event_id", body.eventId);
    expect(count).toBe(1);
  });

  it("rejects a wrong secret and a tampered body, storing nothing", async () => {
    const body = receipt();
    expect((await inboundWebhook(signedRequest(body, { secret: "wrong" }))).status).toBe(401);
    expect((await inboundWebhook(signedRequest(body, { tamper: true }))).status).toBe(401);
    const { count } = await admin.from("inbound_event").select("event_id", { count: "exact", head: true }).eq("event_id", body.eventId);
    expect(count).toBe(0);
  });

  it("a malformed reference is the sender's error (400), never a 500", async () => {
    const body = { ...receipt(), data: { reference: "not-a-uuid" } };
    const res = await inboundWebhook(signedRequest(body));
    expect(res.status).toBe(400);
  });

  it("the same eventId delivered twice is acknowledged twice and stored once", async () => {
    const body = receipt();
    const first = await inboundWebhook(signedRequest(body));
    const second = await inboundWebhook(signedRequest(body));
    expect(await first.json()).toEqual({ received: true, duplicate: false });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ received: true, duplicate: true });
    const { count } = await admin.from("inbound_event").select("event_id", { count: "exact", head: true }).eq("event_id", body.eventId);
    expect(count).toBe(1);
  });
});
