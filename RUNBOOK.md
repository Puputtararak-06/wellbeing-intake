# Runbook — Wellbeing Intake & Booking (Team 16)

## Ownership

| Area | Owner | Backup |
| --- | --- | --- |
| Service overall / demo lead | `TODO name` | `TODO name` |
| Database, migrations, seed | `TODO name` | `TODO name` |
| Identity adapter, sessions | `TODO name` | `TODO name` |
| Webhooks (Team 20 contact: `TODO`) | `TODO name` | `TODO name` |
| Vercel project owner (Hobby is single-owner — env vars bottleneck here) | `TODO name` | — |

Partner contacts: Team 01 Identity `TODO` · Team 20 Notification Hub `TODO` · Team 23 Gateway `TODO`.

Acute-flagged requests (BR-04): owned by the intake coordinator until a practitioner marks them
Escalated. Demo-world response time: `TODO — agree with instructor`.

## Health check

```bash
curl -s https://<host>/api/v1/health
# {"status":"ok","service":"wellbeing","version":"<sha>","database":"up"}   -> 200
# {"status":"degraded", ... "database":"down"}                              -> 503
```

`/emergency` and the home page shell are static: they stay up even when this returns 503.

Every log line is one JSON object with `cid` (correlation id). To trace one request end to end,
filter Vercel function logs by that `cid`; webhook deliveries log `kind:"webhook"` with `eventId`,
`attempt`, `status`, `outcome`.

## Failure recovery

### Database paused (Supabase Free pauses after ~7 days idle) — most likely failure
Symptom: health 503, every screen except `/` shell and `/emergency` errors.
1. Supabase dashboard → project → **Restore**. Wait until active.
2. `pnpm seed` against it if data was lost or stale.
3. Confirm health 200. Check the *Dispatch & keep-alive* workflow is green — it is what prevents this.

### Webhook deliveries failing / parked
Symptom: logs show `outcome:"retry_scheduled"` or `"parked"`; bookings still succeed (by design).
```sql
select event_id, type, attempts, last_status, next_attempt_at, failed_at
  from outbound_event where delivered_at is null order by occurred_at;
```
- Retrying rows recover on their own once the Hub is back (exponential backoff).
- Replay parked rows after the Hub is fixed:
  ```sql
  update outbound_event set failed_at = null, next_attempt_at = now()
   where failed_at is not null and delivered_at is null;
  ```
  then trigger a dispatch (below). `eventId` is unchanged, so the Hub de-duplicates.
- A reminder whose appointment time has passed is pointless: leave it parked.

### Trigger a dispatch by hand
```bash
curl -s -X POST https://<host>/api/v1/internal/events/dispatch -H "Authorization: Bearer $DISPATCH_TOKEN"
# {"enqueued":0,"claimed":1,"delivered":1,"retrying":0,"parked":0}
```

### AI helper down
Nothing to do: the keyword fallback answers automatically and the response says `mode:"fallback"`.
To force fallback (cost, misbehaviour): set `AI_FINDER_ENABLED=false` in Vercel and redeploy.

### Team 01 Identity down on demo day
Set `IDENTITY_MODE=fixture` in Vercel, redeploy, sign in with demo accounts. State the fallback openly.

### A secret leaked (service-role key, signing secret, dispatch token, LLM key)
1. Rotate it at the source (Supabase → API settings; agree a new signing secret with Team 20; generate a new token).
2. Update Vercel env vars **and** GitHub Actions secrets. Redeploy.
3. `pnpm build && pnpm scan:bundle` to confirm the client bundle is clean.
4. Because data is seeded and disposable, run `pnpm seed` to discard anything written meanwhile.

### Reset the whole dataset (NFR-09)
`pnpm seed` — truncates every table, deletes every auth user, reloads fixtures. Local full rebuild:
`pnpm db:reset`.

## Deploy

Vercel auto-deploys `main`; pull requests get previews (they share the one hosted database — reseed
after testing on a preview). Schema changes: add a migration under `supabase/migrations`, then
`pnpm exec supabase db push` against the linked project **before** merging code that needs it.

Required Vercel env vars: everything in `.env.example` (no `NEXT_PUBLIC_` prefixes). Generate fresh
values for `HUB_SIGNING_SECRET`, `HUB_INBOUND_SECRET` and `DISPATCH_TOKEN` (`openssl rand -hex 24`) —
the app refuses empty or placeholder values. Set `MOCK_HUB_ENABLED=false` once Team 20's real endpoint
is configured; while it is true, the mock's outage switch (`PUT`) requires the `DISPATCH_TOKEN` bearer.

In the hosted Supabase project, **disable sign-ups** (Authentication → Sign In / Providers → turn off
"Allow new users to sign up"). Accounts come from `pnpm seed` only (BR-21); the identity adapter also
ignores any account that lacks the seeded `app_metadata.kind`.

Required GitHub Actions secrets: `APP_URL`, `DISPATCH_TOKEN`.

## Pre-demo checklist

- [ ] Supabase project active; `pnpm seed` run; health 200
- [ ] `pnpm test && pnpm test:integration` green; CI green on `main`
- [ ] `pnpm build && pnpm scan:bundle` clean
- [ ] Identity mode decided and one sign-in tested in it
- [ ] One reminder delivered to the Hub target with a valid signature; no parked outbox rows
- [ ] Helper checked twice: `mode:"ai"` and, with the flag off, `mode:"fallback"`
- [ ] Scripted journey + urgent-escalation edge case rehearsed with zero failures
- [ ] Screens checked for demo-only data before any screenshot is taken
