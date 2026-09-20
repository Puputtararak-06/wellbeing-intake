import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as createRequest } from "@/app/api/v1/requests/route";
import { GET as myRequests } from "@/app/api/v1/requests/me/route";
import { PATCH as patchRequest } from "@/app/api/v1/requests/[id]/route";
import { POST as viewContent } from "@/app/api/v1/requests/[id]/content-views/route";
import { GET as requestSlots } from "@/app/api/v1/requests/[id]/slots/route";
import { GET as queue } from "@/app/api/v1/queue/route";
import { GET as coordinatorRequests } from "@/app/api/v1/coordinator/requests/route";
import { GET as practitionerSlots } from "@/app/api/v1/practitioners/[id]/slots/route";
import { POST as publishSlot } from "@/app/api/v1/slots/route";
import { DELETE as removeSlot } from "@/app/api/v1/slots/[id]/route";
import { POST as book } from "@/app/api/v1/appointments/route";
import { POST as cancel } from "@/app/api/v1/appointments/[id]/cancel/route";
import { USERS, admin, anon, call, captureLogs, makeSlot, requestBody, serviceId, userId } from "./helpers";

let counselling: string;
let clinic: string;

beforeAll(async () => {
  counselling = await serviceId("counselling");
  clinic = await serviceId("health-clinic");
});

async function submit(as: string, service: string, overrides: Record<string, unknown> = {}) {
  const r = await call(createRequest, { method: "POST", path: "/requests", as, body: requestBody(service, overrides) });
  expect(r.status).toBe(201);
  return r.json.id as string;
}

async function openAs(practitioner: string, id: string) {
  return call(viewContent, { method: "POST", path: `/requests/${id}/content-views`, as: practitioner, params: { id } });
}

async function auditCount(id: string) {
  const { count } = await admin.from("audit_event").select("id", { count: "exact", head: true }).eq("request_id", id);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
describe("Request (FR-05, FR-06, K-11, K-17)", () => {
  it("rejects a submission with no urgency level", async () => {
    const body = requestBody(counselling) as Record<string, unknown>;
    delete body.triageLevelId;
    const r = await call(createRequest, { method: "POST", path: "/requests", as: USERS.studentA, body });
    expect(r.status).toBe(400);
    expect(r.json.fields).toContain("triageLevelId");
  });

  it("rejects any field outside the FR-05 allowlist", async () => {
    const r = await call(createRequest, {
      method: "POST",
      path: "/requests",
      as: USERS.studentA,
      body: requestBody(counselling, { phoneNumber: "000" }),
    });
    expect(r.status).toBe(400);
  });

  it("only accepts the three hard-coded urgency levels", async () => {
    const r = await call(createRequest, { method: "POST", path: "/requests", as: USERS.studentA, body: requestBody(counselling, { triageLevelId: 4 }) });
    expect(r.status).toBe(400);
  });

  it("a double-click / retry with the same submission key yields exactly one request", async () => {
    const body = requestBody(counselling);
    const first = await call(createRequest, { method: "POST", path: "/requests", as: USERS.studentA, body });
    const second = await call(createRequest, { method: "POST", path: "/requests", as: USERS.studentA, body });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.json.id).toBe(first.json.id);
    expect(second.json.created).toBe(false);
    const { count } = await admin.from("request").select("id", { count: "exact", head: true }).eq("submission_key", body.submissionKey);
    expect(count).toBe(1);
  });

  it("content is frozen at submission — even the service role cannot edit it", async () => {
    const id = await submit(USERS.studentA, counselling);
    const { error } = await admin.from("request").update({ structured_description: "edited" }).eq("id", id);
    expect(error).not.toBeNull();
    const downgrade = await admin.from("request").update({ triage_level_id: 2 }).eq("id", id);
    expect(downgrade.error).not.toBeNull(); // BR-02: nobody downgrades a self-assessment
  });

  it("the persisted request holds only the allowlisted fields (NFR-03)", async () => {
    const id = await submit(USERS.studentA, counselling);
    const { data } = await admin.from("request").select("*").eq("id", id).single();
    expect(Object.keys(data!).sort()).toEqual(
      ["free_text", "id", "preferred_times", "service_id", "status", "structured_description", "student_id", "submission_key", "submitted_at", "triage_level_id"].sort(),
    );
    const user = await admin.from("app_user").select("*").eq("email", USERS.studentA).single();
    expect(Object.keys(user.data!).sort()).toEqual(["created_at", "display_name", "email", "id", "identity_ref", "role", "service_id"].sort());
  });
});

// ---------------------------------------------------------------------------
describe("Privacy (NFR-02, NFR-05, NFR-07, BR-07)", () => {
  it("denial of someone else's record is byte-identical to a nonexistent record", async () => {
    const id = await submit(USERS.studentA, counselling);
    await openAs(USERS.counsellor1, id); // now In review, so A could list slots

    const fake = randomUUID();
    const others = await call(requestSlots, { path: `/requests/${id}/slots`, as: USERS.studentB, params: { id } });
    const absent = await call(requestSlots, { path: `/requests/${fake}/slots`, as: USERS.studentB, params: { id: fake } });
    expect(others.status).toBe(404);
    expect(absent.status).toBe(others.status);
    expect(absent.text).toBe(others.text);

    // same for a practitioner of a DIFFERENT service trying to read content
    const wrongService = await openAs(USERS.nurse, id);
    const absentContent = await openAs(USERS.nurse, fake);
    expect(wrongService.status).toBe(404);
    expect(absentContent.text).toBe(wrongService.text);
    expect(wrongService.text).not.toContain("demo description");
  });

  it("N practitioner views produce exactly N content-free audit events", async () => {
    const id = await submit(USERS.studentA, counselling, { structuredDescription: "audit-sentinel-text" });
    const before = await auditCount(id);
    for (let i = 0; i < 3; i++) expect((await openAs(USERS.counsellor1, id)).status).toBe(201);
    expect((await auditCount(id)) - before).toBe(3);

    const { data } = await admin.from("audit_event").select("*").eq("request_id", id);
    for (const e of data!) {
      expect(Object.keys(e).sort()).toEqual(["id", "request_id", "viewed_at", "viewer_id", "viewer_role"]);
      expect(JSON.stringify(e)).not.toContain("audit-sentinel-text");
    }
  });

  it("a denied read writes no audit event, and neither does loading the queue or the owner's own list", async () => {
    const id = await submit(USERS.studentA, counselling);
    const before = await auditCount(id);
    await openAs(USERS.nurse, id); // denied
    for (let i = 0; i < 3; i++) await call(queue, { path: "/queue", as: USERS.counsellor1 });
    await call(myRequests, { path: "/requests/me", as: USERS.studentA });
    expect(await auditCount(id)).toBe(before);
  });

  it("the queue carries metadata only", async () => {
    await submit(USERS.studentA, counselling, { structuredDescription: "queue-sentinel", freeText: "queue-free-sentinel", preferredTimes: "queue-times-sentinel" });
    const r = await call(queue, { path: "/queue", as: USERS.counsellor1 });
    expect(r.status).toBe(200);
    expect(r.text).not.toMatch(/queue-sentinel|queue-free-sentinel|queue-times-sentinel/);
    for (const row of r.json.queue as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(["id", "status", "submittedAt", "triageLevelId"]);
    }
  });

  it("audit events are append-only", async () => {
    const id = await submit(USERS.studentA, counselling);
    await openAs(USERS.counsellor1, id);
    const del = await admin.from("audit_event").delete().eq("request_id", id);
    expect(del.error).not.toBeNull();
    const upd = await admin.from("audit_event").update({ viewer_role: "x" }).eq("request_id", id);
    expect(upd.error).not.toBeNull();
  });

  it("a sentinel string appears in no log line, no error, and no coordinator or student-list response", async () => {
    const sentinel = `SENTINEL-${randomUUID()}`;
    const { logs } = await captureLogs(async () => {
      const id = await submit(USERS.studentA, counselling, { structuredDescription: sentinel, freeText: sentinel, preferredTimes: sentinel });
      await openAs(USERS.counsellor1, id);
      await openAs(USERS.nurse, id);
      const bad = await call(createRequest, { method: "POST", path: "/requests", as: USERS.studentA, body: requestBody(counselling, { structuredDescription: sentinel, extra: sentinel }) });
      expect(bad.text).not.toContain(sentinel); // validation errors never echo values
      const coord = await call(coordinatorRequests, { path: "/coordinator/requests", as: USERS.coordinator });
      expect(coord.text).not.toContain(sentinel);
      const mine = await call(myRequests, { path: "/requests/me", as: USERS.studentA });
      expect(mine.text).not.toContain(sentinel);
    });
    expect(logs).not.toContain(sentinel);
  });
});

// ---------------------------------------------------------------------------
describe("Role boundary (FR-21, NFR-01, PR-01..PR-06)", () => {
  it("unauthenticated callers get 401 and nothing else", async () => {
    for (const r of [
      await call(myRequests, { path: "/requests/me" }),
      await call(queue, { path: "/queue" }),
      await call(coordinatorRequests, { path: "/coordinator/requests" }),
      await call(createRequest, { method: "POST", path: "/requests", body: requestBody(counselling) }),
    ]) {
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ error: "unauthenticated" });
    }
  });

  it("every capability outside a role's column fails closed with the same 404", async () => {
    const id = await submit(USERS.studentA, counselling);
    const slot = await makeSlot(USERS.counsellor1);
    const denied = [
      // student
      await call(queue, { path: "/queue", as: USERS.studentA }),
      await call(coordinatorRequests, { path: "/coordinator/requests", as: USERS.studentA }),
      await openAs(USERS.studentA, id),
      await call(patchRequest, { method: "PATCH", path: `/requests/${id}`, as: USERS.studentA, params: { id }, body: { status: "closed" } }),
      await call(publishSlot, { method: "POST", path: "/slots", as: USERS.studentA, body: { startAt: new Date(Date.now() + 9e8).toISOString() } }),
      await call(removeSlot, { method: "DELETE", path: `/slots/${slot}`, as: USERS.studentA, params: { id: slot } }),
      // practitioner
      await call(createRequest, { method: "POST", path: "/requests", as: USERS.counsellor1, body: requestBody(counselling) }),
      await call(myRequests, { path: "/requests/me", as: USERS.counsellor1 }),
      await call(coordinatorRequests, { path: "/coordinator/requests", as: USERS.counsellor1 }),
      await call(book, { method: "POST", path: "/appointments", as: USERS.counsellor1, body: { requestId: id, slotId: slot } }),
      await call(removeSlot, { method: "DELETE", path: `/slots/${slot}`, as: USERS.counsellor2, params: { id: slot } }), // not their slot
      await call(patchRequest, { method: "PATCH", path: `/requests/${id}`, as: USERS.nurse, params: { id }, body: { status: "closed" } }), // other service
      // coordinator: strictly read-only metadata
      await openAs(USERS.coordinator, id),
      await call(queue, { path: "/queue", as: USERS.coordinator }),
      await call(createRequest, { method: "POST", path: "/requests", as: USERS.coordinator, body: requestBody(counselling) }),
      await call(patchRequest, { method: "PATCH", path: `/requests/${id}`, as: USERS.coordinator, params: { id }, body: { status: "closed" } }),
      await call(book, { method: "POST", path: "/appointments", as: USERS.coordinator, body: { requestId: id, slotId: slot } }),
    ];
    for (const r of denied) {
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ error: "not_found" });
    }
  });

  it("no role can edit request content through the API", async () => {
    const id = await submit(USERS.studentA, counselling);
    const r = await call(patchRequest, {
      method: "PATCH",
      path: `/requests/${id}`,
      as: USERS.counsellor1,
      params: { id },
      body: { status: "closed", structuredDescription: "edited" },
    });
    expect(r.status).toBe(400);
  });

  it("the coordinator sees metadata only, across services, urgent first", async () => {
    await submit(USERS.studentB, clinic, { structuredDescription: "coord-sentinel", triageLevelId: 1 });
    await submit(USERS.studentB, counselling, { structuredDescription: "coord-sentinel", triageLevelId: 3 });
    const r = await call(coordinatorRequests, { path: "/coordinator/requests", as: USERS.coordinator });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("coord-sentinel");
    const rows = r.json.requests as { triageLevelId: number; acute: boolean }[];
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["acute", "id", "lastStatusChangeAt", "serviceName", "status", "submittedAt", "triageLevelId"]);
    }
    const levels = rows.map((x) => x.triageLevelId);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
    expect(rows[0].acute).toBe(true);
  });

  it("the browser's anon key is a dead end: deny-all RLS and no executable functions", async () => {
    const browser = anon();
    for (const table of ["request", "appointment", "audit_event", "app_user", "outbound_event", "slot"]) {
      const { data, error } = await browser.from(table).select("*").limit(1);
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
    const rpc = await browser.rpc("read_request_content", { p_request: randomUUID(), p_viewer: randomUUID() });
    expect(rpc.error).not.toBeNull();
    const reset = await browser.rpc("reset_demo_data");
    expect(reset.error).not.toBeNull();
  });

  it("a cookie-authenticated write from another origin is rejected (CSRF, NFR-19)", async () => {
    // A cookie session cannot be minted here without a browser, so assert the guard's contract
    // on the sign-in endpoint, which applies the same origin rule.
    const { POST: signIn } = await import("@/app/api/v1/session/route");
    const r = await call(signIn, {
      method: "POST",
      path: "/session",
      headers: { origin: "https://evil.example" },
      body: { email: USERS.studentA, password: "whatever-it-is" },
    });
    expect(r.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("Status lifecycle (FR-12, BR-08, K-12, K-13)", () => {
  it("first practitioner read moves Submitted -> In review exactly once, with that practitioner as actor", async () => {
    const id = await submit(USERS.studentA, counselling);
    const before = await admin.from("request").select("status").eq("id", id).single();
    expect(before.data!.status).toBe("submitted");

    await openAs(USERS.counsellor2, id);
    await openAs(USERS.counsellor1, id);

    const after = await admin.from("request").select("status").eq("id", id).single();
    expect(after.data!.status).toBe("in_review");
    const history = await admin.from("request_status_change").select("new_status, actor_id").eq("request_id", id).order("id");
    expect(history.data!.map((h) => h.new_status)).toEqual(["submitted", "in_review"]);
    expect(history.data![1].actor_id).toBe(await userId(USERS.counsellor2));
  });

  it("only the fixed transitions are legal and terminal statuses never revert", async () => {
    const id = await submit(USERS.studentA, counselling);
    const patch = (status: string) =>
      call(patchRequest, { method: "PATCH", path: `/requests/${id}`, as: USERS.counsellor1, params: { id }, body: { status } });
    expect((await patch("in_review")).status).toBe(400); // never set by hand
    expect((await patch("handled")).status).toBe(400); // only booking sets it
    expect((await patch("closed")).status).toBe(200);
    expect((await patch("escalated")).status).toBe(409); // Closed is terminal
    const history = await admin.from("request_status_change").delete().eq("request_id", id);
    expect(history.error).not.toBeNull(); // append-only
  });
});

// ---------------------------------------------------------------------------
describe("Booking (FR-15, FR-16, FR-17, BR-10, K-1, K-4, K-8)", () => {
  it("is rejected until a practitioner has opened the request, and open slots are hidden until then", async () => {
    const id = await submit(USERS.studentA, counselling);
    const slot = await makeSlot(USERS.counsellor1);
    const early = await call(book, { method: "POST", path: "/appointments", as: USERS.studentA, body: { requestId: id, slotId: slot } });
    expect(early.status).toBe(409);
    expect(early.json).toEqual({ error: "request_not_bookable" });
    const hidden = await call(requestSlots, { path: `/requests/${id}/slots`, as: USERS.studentA, params: { id } });
    expect(hidden.status).toBe(404);
    const counsellorId = await userId(USERS.counsellor1);
    const hidden2 = await call(practitionerSlots, { path: `/practitioners/${counsellorId}/slots`, as: USERS.studentC, params: { id: counsellorId } });
    expect(hidden2.status).toBe(404);
  });

  it("books one open slot atomically and marks the request Handled", async () => {
    const id = await submit(USERS.studentA, counselling);
    await openAs(USERS.counsellor1, id);
    const slot = await makeSlot(USERS.counsellor1);

    const listed = await call(requestSlots, { path: `/requests/${id}/slots`, as: USERS.studentA, params: { id } });
    expect((listed.json.slots as { id: string }[]).map((s) => s.id)).toContain(slot);

    const r = await call(book, { method: "POST", path: "/appointments", as: USERS.studentA, body: { requestId: id, slotId: slot } });
    expect(r.status).toBe(201);

    const appt = await admin.from("appointment").select("request_id, slot_id, student_id, status").eq("id", r.json.id).single();
    expect(appt.data).toEqual({ request_id: id, slot_id: slot, student_id: await userId(USERS.studentA), status: "confirmed" });
    const req = await admin.from("request").select("status").eq("id", id).single();
    expect(req.data!.status).toBe("handled");
    const last = await admin.from("request_status_change").select("new_status").eq("request_id", id).order("id", { ascending: false }).limit(1).single();
    expect(last.data!.new_status).toBe("handled");
  });

  it("two concurrent attempts on the same slot yield exactly one appointment and one clear rejection", async () => {
    const a = await submit(USERS.studentA, counselling);
    const b = await submit(USERS.studentB, counselling);
    await openAs(USERS.counsellor1, a);
    await openAs(USERS.counsellor1, b);
    const slot = await makeSlot(USERS.counsellor1);
    await makeSlot(USERS.counsellor1); // something left to offer the loser

    const [ra, rb] = await Promise.all([
      call(book, { method: "POST", path: "/appointments", as: USERS.studentA, body: { requestId: a, slotId: slot } }),
      call(book, { method: "POST", path: "/appointments", as: USERS.studentB, body: { requestId: b, slotId: slot } }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(loser.json.error).toBe("slot_taken");
    expect(Array.isArray(loser.json.slots)).toBe(true); // refreshed availability
    expect((loser.json.slots as { id: string }[]).map((s) => s.id)).not.toContain(slot);

    const { count } = await admin.from("appointment").select("id", { count: "exact", head: true }).eq("slot_id", slot).eq("status", "confirmed");
    expect(count).toBe(1);
  });

  it("cannot book someone else's request, a slot of another service, or a past slot", async () => {
    const id = await submit(USERS.studentA, counselling);
    await openAs(USERS.counsellor1, id);
    const counsellingSlot = await makeSlot(USERS.counsellor1);
    const clinicSlot = await makeSlot(USERS.nurse);

    const notMine = await call(book, { method: "POST", path: "/appointments", as: USERS.studentB, body: { requestId: id, slotId: counsellingSlot } });
    expect(notMine.status).toBe(404);
    const wrongService = await call(book, { method: "POST", path: "/appointments", as: USERS.studentA, body: { requestId: id, slotId: clinicSlot } });
    expect(wrongService.status).toBe(404);

    const past = await admin.from("slot").insert({ practitioner_id: await userId(USERS.counsellor1), start_at: new Date(Date.now() - 3_600_000).toISOString() }).select("id").single();
    const pastBooking = await call(book, { method: "POST", path: "/appointments", as: USERS.studentA, body: { requestId: id, slotId: past.data!.id } });
    expect(pastBooking.status).toBe(409); // server clock decides (K-9)
  });

  it("a booked slot cannot be removed; an unbooked one can (K-7)", async () => {
    const id = await submit(USERS.studentA, counselling);
    await openAs(USERS.counsellor1, id);
    const slot = await makeSlot(USERS.counsellor1);
    await call(book, { method: "POST", path: "/appointments", as: USERS.studentA, body: { requestId: id, slotId: slot } });
    const blocked = await call(removeSlot, { method: "DELETE", path: `/slots/${slot}`, as: USERS.counsellor1, params: { id: slot } });
    expect(blocked.status).toBe(409);
    const free = await makeSlot(USERS.counsellor1);
    const ok = await call(removeSlot, { method: "DELETE", path: `/slots/${free}`, as: USERS.counsellor1, params: { id: free } });
    expect(ok.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("Cancellation (FR-19, FR-20, BR-13..BR-15, K-5)", () => {
  it("one action, no justification; the slot reopens immediately; the request stays terminal", async () => {
    const id = await submit(USERS.studentA, counselling);
    await openAs(USERS.counsellor1, id);
    const slot = await makeSlot(USERS.counsellor1);
    const booked = await call(book, { method: "POST", path: "/appointments", as: USERS.studentA, body: { requestId: id, slotId: slot } });
    const appt = booked.json.id as string;

    const notMine = await call(cancel, { method: "POST", path: `/appointments/${appt}/cancel`, as: USERS.studentB, params: { id: appt } });
    expect(notMine.status).toBe(404);

    const r = await call(cancel, { method: "POST", path: `/appointments/${appt}/cancel`, as: USERS.studentA, params: { id: appt } });
    expect(r.status).toBe(200);

    // The slot is bookable again for another student's In-review request.
    const other = await submit(USERS.studentB, counselling);
    await openAs(USERS.counsellor1, other);
    const again = await call(book, { method: "POST", path: "/appointments", as: USERS.studentB, body: { requestId: other, slotId: slot } });
    expect(again.status).toBe(201);

    // BR-14: no rescheduling — the original request is Handled and cannot be booked again.
    const free = await makeSlot(USERS.counsellor1);
    const rebook = await call(book, { method: "POST", path: "/appointments", as: USERS.studentA, body: { requestId: id, slotId: free } });
    expect(rebook.status).toBe(409);
    expect(rebook.json).toEqual({ error: "request_not_bookable" });

    const twice = await call(cancel, { method: "POST", path: `/appointments/${appt}/cancel`, as: USERS.studentA, params: { id: appt } });
    expect(twice.status).toBe(404);
  });

  it("after cancellation the prior request's content surfaces nowhere to the student", async () => {
    const id = await submit(USERS.studentC, counselling, { structuredDescription: "cancel-sentinel", freeText: "cancel-sentinel" });
    await openAs(USERS.counsellor1, id);
    const slot = await makeSlot(USERS.counsellor1);
    const booked = await call(book, { method: "POST", path: "/appointments", as: USERS.studentC, body: { requestId: id, slotId: slot } });
    await call(cancel, { method: "POST", path: `/appointments/${booked.json.id}/cancel`, as: USERS.studentC, params: { id: booked.json.id as string } });
    const mine = await call(myRequests, { path: "/requests/me", as: USERS.studentC });
    expect(mine.text).not.toContain("cancel-sentinel");
  });

  it("no penalty or booking-limit machinery exists in the schema (BR-15)", async () => {
    const appt = await admin.from("appointment").select("*").limit(1);
    const columns = Object.keys(appt.data?.[0] ?? {});
    for (const c of columns) expect(c).not.toMatch(/penalty|strike|no_show|reason|limit/);
  });
});

// ---------------------------------------------------------------------------
describe("Urgent escalation (FR-08, BR-03, BR-04, BR-10)", () => {
  it("records the request flagged acute, surfaces it first, blocks booking server-side, and records the handoff", async () => {
    const created = await call(createRequest, { method: "POST", path: "/requests", as: USERS.studentA, body: requestBody(counselling, { triageLevelId: 3 }) });
    expect(created.status).toBe(201);
    expect(created.json.acute).toBe(true); // the client foregrounds emergency contacts on this flag
    const id = created.json.id as string;

    const q = await call(queue, { path: "/queue", as: USERS.counsellor1 });
    expect((q.json.queue as { triageLevelId: number }[])[0].triageLevelId).toBe(3);

    await openAs(USERS.counsellor1, id); // In review — and STILL not bookable
    const slot = await makeSlot(USERS.counsellor1);
    const attempt = await call(book, { method: "POST", path: "/appointments", as: USERS.studentA, body: { requestId: id, slotId: slot } });
    expect(attempt.status).toBe(409);
    expect(attempt.json).toEqual({ error: "request_not_bookable" });
    const hidden = await call(requestSlots, { path: `/requests/${id}/slots`, as: USERS.studentA, params: { id } });
    expect(hidden.status).toBe(404);

    const mine = await call(myRequests, { path: "/requests/me", as: USERS.studentA });
    expect((mine.json.requests as { id: string; bookable: boolean }[]).find((r) => r.id === id)!.bookable).toBe(false);

    const escalated = await call(patchRequest, { method: "PATCH", path: `/requests/${id}`, as: USERS.counsellor1, params: { id }, body: { status: "escalated" } });
    expect(escalated.status).toBe(200);
  });

  it("emergency contacts are static content with no data dependency (NFR-11)", async () => {
    const { EMERGENCY_CONTACTS, CANNOT_HELP_NOW } = await import("@/lib/emergency");
    expect(EMERGENCY_CONTACTS.length).toBeGreaterThan(0);
    expect(CANNOT_HELP_NOW).toMatch(/cannot provide immediate help/);
    const source = (await import("node:fs")).readFileSync("src/components/EmergencyBanner.tsx", "utf8");
    expect(source).not.toMatch(/use client|fetch\(|useEffect|supabase/);
  });
});
