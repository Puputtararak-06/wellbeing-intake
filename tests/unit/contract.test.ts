import { describe, expect, it } from "vitest";
import { REMINDER_MESSAGE, buildEnvelope, envelope, reminderData, cancelledData, sign, verify } from "@/lib/events/contract";

const reference = "6f1c2a9e-7b1d-4c55-9a53-0d2f8e4b7a10";
const row = {
  event_id: "b3e0d6c4-2f7a-4e91-8c1d-5a9f3b2e6d47",
  type: "appointment.reminder",
  occurred_at: "2026-10-05T02:00:00Z",
  subject: "student:abc-123",
  payload: { appointmentAt: "2026-10-06T02:00:00Z", message: REMINDER_MESSAGE, reference },
};

describe("reminder payload allowlist (NFR-06, FR-18)", () => {
  it("accepts exactly date/time, generic text, opaque reference", () => {
    expect(reminderData.safeParse(row.payload).success).toBe(true);
  });

  it.each(["serviceName", "practitioner", "reason", "triageLevel", "description"])(
    "blocks an over-full payload carrying %s",
    (field) => {
      expect(reminderData.safeParse({ ...row.payload, [field]: "x" }).success).toBe(false);
      expect(() => buildEnvelope({ ...row, payload: { ...row.payload, [field]: "x" } })).toThrow();
    },
  );

  it("only allows the fixed generic wording", () => {
    expect(reminderData.safeParse({ ...row.payload, message: "Your counselling session is tomorrow" }).success).toBe(false);
  });

  it("retraction data is the opaque reference only", () => {
    expect(cancelledData.safeParse({ reference }).success).toBe(true);
    expect(cancelledData.safeParse({ reference, appointmentAt: "2026-10-06T02:00:00Z" }).success).toBe(false);
  });
});

describe("platform envelope (NFR-17)", () => {
  it("has exactly the six platform fields and a constant source", () => {
    const e = buildEnvelope(row);
    expect(Object.keys(e).sort()).toEqual(["data", "eventId", "occurredAt", "source", "subject", "type"]);
    expect(e.source).toBe("wellbeing");
    expect(e.eventId).toBe(row.event_id);
    expect(envelope.safeParse(e).success).toBe(true);
  });

  it("names no service, practitioner or reason anywhere in the serialized event", () => {
    const text = JSON.stringify(buildEnvelope(row)).toLowerCase();
    for (const word of ["counsel", "clinic", "physio", "nurse", "urgent", "triage"]) expect(text).not.toContain(word);
  });
});

describe("webhook signing (NFR-17)", () => {
  const secret = "test-secret";
  const body = JSON.stringify(buildEnvelope(row));
  const now = 1_790_000_000_000;
  const ts = String(now / 1000);

  it("verifies a correctly signed body", () => {
    expect(verify(body, sign(body, ts, secret), ts, secret, now)).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    expect(verify(body + " ", sign(body, ts, secret), ts, secret, now)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects the wrong secret", () => {
    expect(verify(body, sign(body, ts, "other"), ts, secret, now)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a stale timestamp (replay bound)", () => {
    const old = String(now / 1000 - 3600);
    expect(verify(body, sign(body, old, secret), old, secret, now)).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects missing headers", () => {
    expect(verify(body, null, null, secret, now)).toEqual({ ok: false, reason: "missing" });
  });
});
