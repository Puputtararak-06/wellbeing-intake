# A5 — Integration Evidence · Team 16 (Private Wellbeing Intake & Booking)

**Team:** 16 — Wellbeing · **Pod:** 4 — Student Support
**Deployed base URL:** `TODO https://<your-app>.vercel.app/api/v1`
**Commit / deploy ID evidenced:** `TODO`
**Evidence captured on:** `TODO YYYY-MM-DD` (all timestamps below in ISO-8601, UTC+7 unless marked)
**Captured by:** `TODO names`

> Every item below must be a real capture from the deployed system — nothing reconstructed, nothing mocked up after the fact. Anything still marked `TODO` is incomplete.

## Redaction rules (apply to every screenshot and log)

- [ ] Seeded demo users only — no real student record anywhere (platform PRD §6, BR-18).
- [ ] Secrets masked: signing secret, machine credential, service-role key, LLM key, bearer tokens (show first 6 characters at most).
- [ ] No request content (description, free text, preferred times) and no triage level in any capture (NFR-07). Use metadata-only views.
- [ ] Each capture shows its correlation ID (`X-Correlation-Id`) so the log lines and screenshots can be tied together.

## Summary

| # | Proof | Partner team | Our PRD reference | Status |
|---|-------|--------------|-------------------|--------|
| 1 | Consumer | Team 01 — Student Identity | BR-26, FR-03 | TODO |
| 2 | Provider | TODO (Team 23 Gateway / Team 13 or 14) | §11.1 `GET /services`, NFR-18 | TODO |
| 3 | Webhook receiver | TODO (Team 20 recommended) | FR-24 (PRD revision 3), `POST /webhooks/notification-hub` | TODO |
| 4 | Webhook sender | Team 20 — Notification Hub | FR-18, NFR-17, §11.5 | TODO |
| 5 | Idempotency | — (ours) / same partner as §3 | K-17 `submission_key`; `eventId` | TODO |
| 6 | Degradation | Team 20 and/or LLM | K-18/K-19, FR-23, BR-24 | TODO |

---

## 1. Consumer Proof — we call a partner's API

**What this proves:** Team 16 consumes another team's service. For us that is Team 01 Student Identity: the identity adapter verifies a Team 01 access token / fetches the required claims (BR-26).

| Field | Value |
|---|---|
| Partner | Team 01 — Student Identity |
| Partner URL called | `TODO https://<team01>/api/v1/...` (token verification key set, or profile-claims endpoint) |
| Our calling code | `TODO path/to/identity-adapter.ts` |
| Request timestamp | `TODO` |
| Correlation ID | `TODO` |
| HTTP status | `TODO` |

**Response body screenshot:** `TODO ![consumer-response](evidence/1-consumer-response.png)`

Response body (text copy, tokens masked):

```json
TODO
```

**What we do with it:** only the identity reference and required contact/access claims are persisted; everything else is discarded (FR-03, BR-19). Show the resulting `User` row (columns only, demo user): `TODO screenshot`

---

## 2. Provider Proof — a partner calls our API

**What this proves:** another team successfully consumes a Team 16 endpoint.

Recommended endpoint: `GET /api/v1/services` — public, contains only the seeded service catalogue, so a partner can call it without any privacy exposure. Natural callers: Team 23 (gateway routing + `GET /api/v1/health`), or Team 13 Advising / Team 14 Helpdesk linking students to wellbeing services.

| Field | Value |
|---|---|
| Our endpoint URL | `TODO https://<your-app>/api/v1/services` |
| Calling partner | `TODO Team NN — name` |
| Request timestamp | `TODO` |
| Correlation ID | `TODO` (ask the partner to send one; it must match our log line) |
| HTTP status returned | `TODO` |

**Internal request log** (our side — Vercel function log line showing method, path, status, correlation ID, caller; no bodies):

```
TODO
```

**Partner confirmation** (screenshot of their message, their log, or their UI rendering our data — with their name and the date visible): `TODO ![partner-confirmation](evidence/2-partner-confirmation.png)`

---

## 3. Webhook Receiver — we receive a partner's event

> **Implemented as FR-24 (PRD revision 3):** `POST /api/v1/webhooks/notification-hub` receives Notification Hub delivery receipts (`notification.delivered` / `notification.failed`) carrying only our opaque `reference`; the signature is verified over the raw body and consumption is idempotent on `eventId`. Still to do: agree the receipt event and the shared secret with Team 20 (or swap the source to a Team 01 event — the receiver is source-agnostic).

| Field | Value |
|---|---|
| Sending partner | `TODO` |
| Our receiver URL | `TODO https://<your-app>/api/v1/webhooks/<source>` |
| Event type | `TODO` |
| Received at | `TODO` |
| `eventId` | `TODO` |

**Incoming payload** (exactly as received):

```json
TODO
```

**Secret verification result** — show both outcomes:

| Case | Signature header | Result | HTTP status | Log line |
|---|---|---|---|---|
| Valid signature | `TODO (masked)` | verified | `TODO 2xx` | `TODO` |
| Tampered body or wrong secret | `TODO (masked)` | rejected | `TODO 401` | `TODO` |

**Stored log** (DB row proving the event was recorded — `eventId`, type, received_at, processed_at): `TODO screenshot or query output`

---

## 4. Webhook Sender — we send an event to a partner

**What this proves:** FR-18 / NFR-17 — a signed `appointment.reminder` reaches Team 20 in the platform envelope.

**Internal trigger action:** student books an appointment (`POST /api/v1/appointments`) → reminder reaches its lead time → dispatcher runs (`POST /api/v1/internal/events/dispatch`).

| Step | Timestamp | Correlation ID | Evidence |
|---|---|---|---|
| Booking created | `TODO` | `TODO` | `TODO log line / screenshot` |
| Outbox row inserted (K-18) | `TODO` | — | `TODO query output: event_id, type, attempts, next_attempt_at` |
| Dispatcher delivered | `TODO` | `TODO` | `TODO log line` |

**Outgoing payload** (must match PRD §11.5 — check: `data` has exactly 3 fields, no service, practitioner, reason, or triage level):

```json
TODO
```

Signature header sent: `TODO (masked)`

**Partner response log:** HTTP status `TODO`, response body `TODO`, plus Team 20's own confirmation that they received and verified it: `TODO ![hub-confirmation](evidence/4-hub-confirmation.png)`

**After delivery:** outbox row shows `delivered_at` set and `subject` / `payload` nulled (K-19): `TODO query output`

---

## 5. Idempotency Proof — same request twice, one record

Two candidates; submit at least one, ideally both.

### 5a. `POST /api/v1/requests` with the same `submission_key` (K-17)

| | Req 1 | Req 2 (replay) |
|---|---|---|
| Timestamp | `TODO` | `TODO` |
| `submission_key` | `TODO` | same |
| HTTP status | `TODO 201` | `TODO 200/201 — returns existing` |
| Returned request id | `TODO` | **same id** |

Payloads (use an obviously fake description such as `"demo-sentinel-A5"` — never realistic content):

```json
TODO Req 1
```

```json
TODO Req 2
```

**DB proof of single creation:**

```sql
select count(*) from request where submission_key = 'TODO';
-- expected: 1
```

`TODO screenshot of the result`

### 5b. Inbound webhook delivered twice with the same `eventId` (from §3)

| | Delivery 1 | Delivery 2 (duplicate) |
|---|---|---|
| Timestamp | `TODO` | `TODO` |
| `eventId` | `TODO` | same |
| HTTP status | `TODO 2xx` | `TODO 2xx (acknowledged, not reprocessed)` |

DB proof: one stored row for that `eventId`, one side effect. `TODO query output`

---

## 6. Degradation Proof — a dependency breaks, we keep working, we recover automatically

### 6a. Notification Hub unreachable (primary — partner dependency)

**How it was broken:** `TODO` (e.g. Hub webhook URL pointed at a dead host / Team 20 took their endpoint down at an agreed time)

| Moment | Timestamp | Evidence |
|---|---|---|
| Breakage | `TODO` | `TODO first failed delivery log line` |
| Booking during outage still succeeds | `TODO` | fallback JSON below |
| Retries backing off (K-19) | `TODO … TODO … TODO` | `TODO outbox row: attempts 1→2→3, next_attempt_at growing, same event_id` |
| Dependency restored | `TODO` | — |
| Automatic recovery — delivered with no manual action | `TODO` | `TODO log line + outbox row delivered_at` |

**Fallback JSON output** (the booking response returned to the student while the Hub was down):

```json
TODO
```

### 6b. LLM unavailable (AI capability with deterministic fallback — FR-23, BR-24)

**How it was broken:** `TODO` (AI flag off / invalid key / forced timeout)

| Moment | Timestamp | Evidence |
|---|---|---|
| Breakage | `TODO` | `TODO helper log: mode=fallback, outcome, latency` |
| Recovery | `TODO` | `TODO helper log: mode=ai` |

**Fallback JSON output** of `POST /api/v1/finder/suggest` during the outage (shows `mode: "fallback"` and a ranked list of seeded service IDs):

```json
TODO
```

Same call after recovery (shows `mode: "ai"`):

```json
TODO
```

---

## Sign-off

| Partner team | Contact | What they confirmed | Date |
|---|---|---|---|
| Team 01 | `TODO` | §1 | `TODO` |
| `TODO` | `TODO` | §2 | `TODO` |
| Team 20 | `TODO` | §3, §4, §6a | `TODO` |

---

## Appendix — how to capture each proof with this codebase

Set once (Git Bash). Use the deployed URL for the real submission; `http://localhost:3000` for a dry run.

```bash
HOST=http://localhost:3000
CID=a5-$(date +%Y%m%dT%H%M%S)            # one correlation id per proof ties screenshots to log lines
login() { curl -s -X POST $HOST/api/v1/session -H 'content-type: application/json' -H "origin: $HOST" \
  -d "{\"email\":\"$1\",\"password\":\"demo-password-16\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken'; }
STUDENT=$(login student.a@demo.test); COUNSELLOR=$(login counsellor.1@demo.test)
```

Server log lines are single-line JSON containing `"cid":"<your CID>"` — in Vercel: Project → Logs → search the CID.

**1 · Consumer (Team 01).** Set `IDENTITY_MODE=campus`, `IDENTITY_JWKS_URL`, `IDENTITY_ISSUER`. Obtain a token from Team 01, then
`curl -i $HOST/api/v1/me -H "Authorization: Bearer $TEAM01_TOKEN" -H "X-Correlation-Id: $CID"`.
A `200` with your role proves the adapter fetched Team 01's key set and verified the token. Screenshot the response and the
partner URL (`IDENTITY_JWKS_URL`) being fetched; repeat with a tampered token to show `401`.

**2 · Provider.** Ask the partner to run (and screenshot)
`curl -i $HOST/api/v1/services -H "X-Correlation-Id: team13-a5-0001"`. Your internal log is the line with that `cid`.

**3 · Webhook receiver.** Partner (or a dry run with their secret) POSTs a signed receipt:

```bash
BODY='{"eventId":"'$(node -p 'crypto.randomUUID()')'","type":"notification.delivered","occurredAt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","source":"notification-hub","subject":"reference:demo","data":{"reference":"'$(node -p 'crypto.randomUUID()')'"}}'
TS=$(date +%s)
SIG=sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$HUB_INBOUND_SECRET" | awk '{print $NF}')
curl -i -X POST $HOST/api/v1/webhooks/notification-hub -H 'content-type: application/json' \
  -H "x-signature: $SIG" -H "x-signature-timestamp: $TS" -H "X-Correlation-Id: $CID" -d "$BODY"
```

Valid → `200 {"received":true,"duplicate":false}` and log `"signature":"verified"`. Change one character of `$BODY` after signing →
`401` and log `"signature":"rejected","reason":"mismatch"`. Stored log: `select * from inbound_event order by received_at desc limit 5;`

**4 · Webhook sender.** Book a slot that starts within 24 h (the seed creates one per practitioner ~20 h ahead): submit a request as
the student, open it as the counsellor, book it as the student (UI or API). The booking triggers an inline dispatch. Evidence:
the `kind:"webhook"` log line (`eventId`, `attempt`, `status`, `outcome:"delivered"`), the payload as Team 20 received it, their
confirmation, and `select event_id,type,attempts,last_status,delivered_at,subject,payload from outbound_event order by occurred_at desc limit 3;`
(subject and payload are `null` after delivery — K-19). To show the payload *before* delivery, unset `HUB_WEBHOOK_URL`, book, query the row, then restore the URL and run the dispatcher.

**5 · Idempotency.** 5a: send the *same* body twice —

```bash
KEY=$(node -p 'crypto.randomUUID()'); SVC=$(curl -s $HOST/api/v1/services | node -pe 'JSON.parse(require("fs").readFileSync(0)).services[0].id')
REQ='{"serviceId":"'$SVC'","structuredDescription":"demo-sentinel-A5","preferredTimes":"any","triageLevelId":1,"submissionKey":"'$KEY'"}'
curl -i -X POST $HOST/api/v1/requests -H "Authorization: Bearer $STUDENT" -H 'content-type: application/json' -d "$REQ"   # 201 created:true
curl -i -X POST $HOST/api/v1/requests -H "Authorization: Bearer $STUDENT" -H 'content-type: application/json' -d "$REQ"   # 200 created:false, same id
```

DB proof: `select count(*) from request where submission_key = '<KEY>';` → `1`. 5b: run the proof-3 curl twice with the same `$BODY` →
second response `"duplicate":true`; `select count(*) from inbound_event where event_id = '<eventId>';` → `1`.

**6 · Degradation.** 6a (Hub down): `curl -X PUT $HOST/api/v1/mock/hub -H "Authorization: Bearer $DISPATCH_TOKEN" -H 'content-type: application/json' -d '{"fail":true}'`
(or have Team 20 take their endpoint down at an agreed time) → book a near-term slot: the booking still returns `201` (the fallback JSON) →
logs show `outcome:"retry_scheduled"` with a growing `nextAttemptAt`, same `eventId` → restore with `{"fail":false}` → the next scheduled
dispatch (or `POST /internal/events/dispatch`) logs `outcome:"delivered"` with no manual data fix: that is the automatic-recovery log.
6b (LLM down): with `AI_FINDER_ENABLED=true`, break `LLM_API_KEY` →
`curl -s -X POST $HOST/api/v1/finder/suggest -H 'content-type: application/json' -d '{"text":"trouble sleeping"}'` → `{"mode":"fallback",...}`;
restore the key → `{"mode":"ai",...}`. The `kind:"finder"` log lines give the breakage and recovery timestamps.
