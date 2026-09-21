# API Contract — Wellbeing (Team 16) → Helpdesk (Team 14)

**For:** A5 cross-team integration · **Contract version:** 1.1 (2026-09-21) — adds §2.1 after reading the Helpdesk PRD v1.0; the API itself is unchanged · **Status:** proposed by Team 16, awaiting Team 14 review

This answers every item in Team 14's *A5 Integration Preparation* checklist (§18). Every value below
was verified against the live system — nothing here is planned or assumed. Items that do not exist
are marked **N/A** with the reason.

| | |
| --- | --- |
| Provider | Team 16 — Private Wellbeing Intake & Booking |
| Consumer | Team 14 — Helpdesk |
| Full machine-readable contract | [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1) |
| Source | <https://github.com/TEERAPAT-SUKKASEM/wellbeing-intake> |
| Contact | Teerapat Sukkasem (Team 16) |

---

## 1. Roles

```text
Helpdesk (Team 14) ───── GET /api/v1/services ─────▶ Wellbeing (Team 16)

Helpdesk  = Consumer
Wellbeing = Provider
```

There is **no webhook** from Wellbeing to Helpdesk (see §8).

## 2. What Wellbeing shares — and what it never will

Wellbeing handles health and counselling requests. Our product rule is that **the fact that a student
contacted a wellbeing service is itself private**: it is visible only to that student and to the
practitioners of the one service they chose. Our own intake coordinator cannot read request content.

So the integration is deliberately limited to **public information**:

| Wellbeing data | Shared with Helpdesk? |
| --- | --- |
| **Service catalogue** — what each service is for, what a first visit looks like, who will know | **Yes** — this is the contract |
| Service health (`up` / `down`) | **Yes** |
| A student's request, case, appointment, status, urgency level, or whether one exists | **Never.** No endpoint, no event, no ID. |

**What this means for your design.** A Helpdesk ticket can record *"we pointed this student to
Counselling"* by storing a **service reference**. It cannot, and should not, record *"this student has
wellbeing case #123"* — that reference would itself be a disclosure. Please do not add a
`case_id` / `appointment_id` / `wellbeing_record_id` field; there is nothing on our side to link it to.

Suggested use: when a Helpdesk ticket is about stress, health, injury or money worries, show the
student the matching Wellbeing service and link them to <https://wellbeing-intake.vercel.app>.
The student then contacts Wellbeing themselves, privately.

### 2.1 How this fits the Helpdesk PRD

Read against your PRD v1.0, the integration slots into things you already have:

| In your PRD | With Wellbeing |
| --- | --- |
| §8.3 — AI triage proposes a **Route** (your example: `Route: Maintenance`) | Add **`Route: Wellbeing`** for tickets about stress, low mood, illness, injury, sleep or money worries |
| §8.2 — AI input "available routing/assignment options" | Our four services (`name` + `whatFor`) are those options. Validate the AI's choice against our `slug` list, exactly as §8.6 requires for categories |
| §8.5 — deterministic fallback | Works unchanged: match your keyword rules to a `slug`. If *we* are unavailable, fall back to a plain "Wellbeing" route with a link to our site |
| §6.1 / BR-04 — store only `maintenance_work_order_id`, never copy the record | Same pattern: store only **`wellbeing_service_slug`**. Fetch `name` / `whatFor` from us when you display it |
| §12 — server-side API logic (Next.js Route Handlers) | Call us from a Route Handler. `wellbeing-client.mjs` in this bundle drops straight in |
| §6.3 — you *consume* `maintenance.status_changed` | **No equivalent from us.** A Wellbeing status event would reveal that a student has a wellbeing request (§8) |

A suggested flow:

```text
Requester creates ticket: "I can't sleep and I'm behind on everything"
        │
        ▼
AI / fallback suggests   Route: Wellbeing  ·  service: wellbeing-advising
        │
        ▼
Helpdesk shows the student our card for that service (name, whatFor, whoWillKnow)
and a link to https://wellbeing-intake.vercel.app
        │
        ▼
Ticket stores  wellbeing_service_slug = "wellbeing-advising"   ← the only thing you keep
        │
        ▼
The student decides whether to contact Wellbeing — privately, on our site, under their own login
```

Two boundaries we ask you to respect:

1. **Do not forward the ticket's subject or description to us.** We have no endpoint that accepts a
   request on a student's behalf, deliberately: a wellbeing request must be written and submitted by
   the student themselves.
2. **A stored slug means "we suggested this service", nothing more.** Please do not show it, in the
   agent queue or anywhere else, as "this student is a Wellbeing client" — you cannot know that, and
   neither should an agent.

## 3. Checklist answers

| # | Item | Answer |
| --- | --- | --- |
| 1 | API Base URL | `https://wellbeing-intake.vercel.app/api/v1` |
| 2 | Endpoint(s) | `GET /services` · `GET /health` |
| 3 | HTTP Method | `GET` only |
| 4 | Request Headers | None required. Optional: `X-Correlation-Id` (§6) |
| 5 | Request Body | None |
| 6 | Response Body | §4 |
| 7 | HTTP Status Codes | §7 |
| 8 | Error Response | §7 |
| 9 | Main Resource | **Service** |
| 10 | Resource Unique ID | **`slug`** — e.g. `counselling`. *Not* `id` — see the warning in §5 |
| 11 | Status Values | **N/A** — a Service has no status. Request/appointment statuses exist but are private (§2) |
| 12 | Status Meaning | N/A |
| 13 | Authentication Method | **None** — both endpoints are public and return no personal data |
| 14 | Webhook / Event | **N/A** (§8) |
| 15 | Event Trigger | N/A |
| 16 | Event Payload | N/A |
| 17 | Event ID | N/A |
| 18 | Retry Behavior | Yours to choose. `GET` is safe to retry. Recommendation in §9 |
| 19 | Idempotency Behavior | `GET` is idempotent by definition: calling it any number of times changes nothing on our side |
| 20 | Test Environment / URL | The base URL above. It is a demo deployment on **seeded, fictional data** — safe to call freely |
| 21 | Test Data | §5 — four seeded services |
| 22 | Test Account / Credential | Not needed for this contract |

## 4. `GET /services`

Returns the whole catalogue (currently four services), ordered by name. No parameters, no pagination.

```bash
curl -i https://wellbeing-intake.vercel.app/api/v1/services -H "X-Correlation-Id: team14-a5-0001"
```

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Correlation-Id: team14-a5-0001
```

```json
{
  "services": [
    {
      "id": "689dfeea-2a43-4aa9-87b4-55cfacaf29bc",
      "slug": "counselling",
      "name": "Counselling",
      "whatFor": "Talking through stress, low mood, anxiety, relationships, grief, or anything that is weighing on you. You do not need a diagnosis or a 'big enough' problem.",
      "firstSession": "A relaxed 50-minute conversation with a counsellor about what is going on and what might help. Nothing is decided for you.",
      "whoWillKnow": "Only the counsellors of this service. Not your lecturers, not your parents, not other students."
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | UUID string | Internal identifier. **Unstable — do not store** (§5) |
| `slug` | string | **Stable unique identifier.** Lowercase, hyphenated |
| `name` | string | Display name |
| `whatFor` | string | What the service helps with |
| `firstSession` | string | What a first visit looks like |
| `whoWillKnow` | string | Who can see a student's request to this service |

All six fields are always present and never `null`. All text is English.

## 5. Test data and the unique ID

| `slug` (store this) | `name` |
| --- | --- |
| `counselling` | Counselling |
| `health-clinic` | Health clinic |
| `physiotherapy` | Physiotherapy |
| `wellbeing-advising` | Wellbeing advising |

> **Warning — use `slug`, not `id`.** Our dataset is disposable by design: `pnpm seed` wipes and
> recreates every row, which generates **new UUIDs** for `id`. The four `slug` values are fixed in our
> seed script and never change. A ticket that stored an `id` would break after our next reseed; a
> ticket that stored `counselling` will not.

Suggested Helpdesk column: `wellbeing_service_slug` (text, nullable).

There is no `GET /services/{slug}` endpoint. To resolve a stored slug, fetch the list and match on
`slug`. A slug that is not in the list means "unknown service" — treat it as your *not found* case.

## 6. Correlation ID

Send `X-Correlation-Id` and we echo it back unchanged and write it on our server log line, so one
request can be traced across both teams' logs — useful for your A5 evidence and ours.

**Format:** 8–128 characters from `A–Z a–z 0–9 _ . : -`. A value that does not match (too short,
contains spaces or `#`) is silently replaced with a random UUID.

| Sent | Returned |
| --- | --- |
| `team14-a5-0001` | `team14-a5-0001` |
| `probe-1` (7 characters) | a random UUID |
| `T14 ticket #5` (space, `#`) | a random UUID |

## 7. Status codes and errors

Errors are always `{"error": "<code>"}` — a stable machine-readable code, never a free-text message.

| Situation | Status | Body |
| --- | --- | --- |
| Success | `200` | §4 |
| Wrong method (e.g. `POST /services`) | `405` | empty |
| Unknown path (e.g. `/services/abc`) | `404` | not JSON — a generic not-found page |
| Our database is unavailable | `500` | `{"error":"internal_error"}` |
| (Not part of this contract) a protected endpoint without a valid token, e.g. `GET /requests/me` | `401` | `{"error":"unauthenticated"}` |

`GET /health` tells you whether we are up before you rely on us:

```bash
curl -s https://wellbeing-intake.vercel.app/api/v1/health
```

| State | Status | Body |
| --- | --- | --- |
| Healthy | `200` | `{"status":"ok","service":"wellbeing","version":"<commit>","database":"up"}` |
| Database down | `503` | `{"status":"degraded", … ,"database":"down"}` |

## 8. Webhooks / events — N/A

Wellbeing sends **no** event to Helpdesk. Our only outbound events (`appointment.reminder`,
`appointment.cancelled`) go to the platform Notification Hub, are addressed to the student alone, and
carry nothing but a time and an opaque reference. Sending any per-student event to Helpdesk would
disclose that the student uses a wellbeing service (§2). The catalogue itself is static seed data, so
there is no "service changed" event either.

Consequently your Test 5 (webhook) and Test 6 (duplicate event) do not apply to this pairing.

## 9. Operational notes

| Topic | Value |
| --- | --- |
| Call from | **Your server only.** We send no CORS headers, so a browser on another origin cannot read the response. Call us from your backend and pass the data to your frontend |
| Rate limit | None enforced by us. Hosting is a free tier — please cache rather than call per page view |
| Caching | We send `Cache-Control: no-store`, but the catalogue is static: caching it on your side for minutes or hours is safe and recommended |
| Typical latency | About 0.2 s (server in Singapore) |
| Timeout | We suggest 3 s |
| If we are down | Keep working: serve your cached copy, or hide the Wellbeing suggestion. Never block a Helpdesk ticket on us |
| Retry | Safe (`GET`). One or two retries with a short back-off is plenty |
| Versioning | Path-versioned (`/api/v1`). We will not remove or rename a field in v1; we may add fields, so ignore unknown ones. A breaking change would ship as `/api/v2` with notice |
| Data | Seeded, fictional, demo-only. No real student record exists in our system |

## 10. Your test plan, mapped to this contract

| Team 14 test | How to run it against us |
| --- | --- |
| 1 — Valid request | `GET /services` → `200`, four services |
| 2 — Invalid request | `POST /services` → `405` |
| 3 — Authentication failure | N/A for this contract (public). If you want to demonstrate one: `GET /requests/me` with no token → `401 {"error":"unauthenticated"}` |
| 4 — Unknown resource | Look up a slug that is not in the list (e.g. `dentistry`) → your code reports *not found*. Or `GET /services/dentistry` → `404` |
| 5 — Webhook | N/A (§8) |
| 6 — Duplicate event | N/A (§8) |
| 7 — Partner failure | Point your client at a wrong host, or set a 1 ms timeout, and show Helpdesk still works (cached copy or hidden suggestion). We will not take the demo deployment down |
| 8 — Recovery | Restore the correct URL / timeout → the next call succeeds, no manual repair |

## 11. Evidence both teams need for A5

Please send us, for Team 16's **Provider proof**:

1. A screenshot of your call to `GET /services` with **`X-Correlation-Id: team14-a5-0001`**, showing
   the `200` response, your team name and the date.
2. **Tell us just before you run it.** Our hosting keeps server logs for only about one hour, and we
   need to screenshot our log line for the same correlation ID inside that window.
3. The name of your contact person, for the sign-off table.

In return we will send you our server log screenshot for that correlation ID — evidence, from the
provider's side, that your request arrived — for your **Consumer proof**.

## 12. Contract lock

| Team | Name | Agreed on |
| --- | --- | --- |
| Team 16 — Wellbeing | Teerapat Sukkasem | 2026-09-21 |
| Team 14 — Helpdesk | `TODO` | `TODO` |
