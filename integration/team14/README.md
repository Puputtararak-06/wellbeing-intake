# Wellbeing (Team 16) — integration bundle for Helpdesk (Team 14)

Everything you need to consume our API for A5. Nothing here needs a key, an account or a secret.

| File | What it is |
| --- | --- |
| [`Team14-Integration-Contract.md`](Team14-Integration-Contract.md) | **Start here.** The API contract — answers all 22 items of your checklist |
| [`openapi.yaml`](openapi.yaml) | Our full OpenAPI 3.1 contract (you only need `GET /services` and `GET /health`) |
| [`Wellbeing-Team16.postman_collection.json`](Wellbeing-Team16.postman_collection.json) | Postman collection with assertions — *Import* → run the collection |
| [`wellbeing-client.mjs`](wellbeing-client.mjs) | Reference consumer (Node 18+, no dependencies): timeout, cache, never throws when we are down |
| [`smoke-test.mjs`](smoke-test.mjs) | Your test plan (tests 1–4, 7, 8) run against our live API |
| [`examples/`](examples) | Real responses captured from the live API |

## Two-minute check

```bash
curl -i https://wellbeing-intake.vercel.app/api/v1/services -H "X-Correlation-Id: team14-a5-0001"
node smoke-test.mjs        # expect: All applicable tests passed
```

## The five things that will save you time

1. **Store `slug`, not `id`.** `counselling`, `health-clinic`, `physiotherapy`, `wellbeing-advising`
   never change. `id` is a UUID that is regenerated whenever we reseed our demo data.
2. **Call us from your server.** We send no CORS headers; a browser on your origin cannot read us.
3. **No student data, ever.** We share the public service catalogue only. There is no case,
   appointment, status or webhook to link a ticket to — that is a privacy decision, explained in the
   contract (§2, §8). Point the student to us; they contact Wellbeing themselves.
4. **Correlation IDs must be 8–128 characters** of `A–Z a–z 0–9 _ . : -`, or we replace them.
5. **Never block a ticket on us.** Cache the catalogue; if we are down, hide the suggestion.

## Using the reference client

```js
import { createWellbeingClient } from "./wellbeing-client.mjs";

const wellbeing = createWellbeingClient();

const { services, available, stale } = await wellbeing.listServices();
// available:false -> hide the Wellbeing suggestion; stale:true -> served from your cache during an outage

const { service } = await wellbeing.getService(ticket.wellbeing_service_slug);
// service === null -> unknown slug (your "not found" case)
```

## For the A5 evidence

Tell us just before you run your evidenced call with `X-Correlation-Id: team14-a5-0001` — our hosting
keeps server logs for about an hour, and we will send you our provider-side log line for that ID.

Contact: Teerapat Sukkasem, Team 16 · Source: <https://github.com/TEERAPAT-SUKKASEM/wellbeing-intake>
