-- Team 16 — Private Wellbeing Intake & Booking
-- Schema: PRD Section 8 (nine entities) plus two operational tables
-- (inbound_event for the A5 webhook receiver, ai_call_budget for NFR-19).
-- Invariant IDs (K-n) refer to the PRD's key-constraints table.

-- ---------------------------------------------------------------------------
-- TriageLevel — sealed reference set of exactly three levels (BR-01, K-10)
-- ---------------------------------------------------------------------------
create table triage_level (
  id    smallint primary key,
  label text     not null unique,
  rank  smallint not null unique check (rank between 1 and 3)
);

insert into triage_level (id, label, rank) values
  (1, 'Routine — within the next couple of weeks is fine', 1),
  (2, 'Soon — I would like to be seen this week', 2),
  (3, 'Urgent — I need help now', 3);

create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% on % is not permitted', tg_op, tg_table_name
    using errcode = 'P0001';
end $$;

create trigger triage_level_sealed
  before insert or update or delete on triage_level
  for each row execute function forbid_change();

-- ---------------------------------------------------------------------------
-- Service — seeded catalogue (FR-01); keywords feed the FR-23 fallback matcher
-- ---------------------------------------------------------------------------
create table service (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  what_for       text not null,
  first_session  text not null,
  who_will_know  text not null,
  keywords       text[] not null default '{}'
);

-- ---------------------------------------------------------------------------
-- User — minimal by design (NFR-03). Visitors are never stored (BR-20).
-- ---------------------------------------------------------------------------
create table app_user (
  id            uuid primary key default gen_random_uuid(),
  identity_ref  text not null unique,                       -- K-15
  email         text not null,                              -- required contact claim
  display_name  text not null,                              -- required contact claim
  role          text not null check (role in ('student', 'practitioner', 'coordinator')),
  service_id    uuid references service (id) on delete restrict,
  created_at    timestamptz not null default now(),
  check ((role = 'practitioner') = (service_id is not null))
);

-- ---------------------------------------------------------------------------
-- Request — the privacy centre of gravity. Field list is a tested allowlist.
-- ---------------------------------------------------------------------------
create table request (
  id                      uuid primary key default gen_random_uuid(),
  student_id              uuid not null references app_user (id) on delete restrict,
  service_id              uuid not null references service (id) on delete restrict,
  structured_description  text not null check (char_length(structured_description) between 1 and 500),
  free_text               text check (free_text is null or char_length(free_text) <= 2000),
  preferred_times         text not null check (char_length(preferred_times) between 1 and 300),
  triage_level_id         smallint not null references triage_level (id) on delete restrict,
  status                  text not null default 'submitted'
                            check (status in ('submitted', 'in_review', 'handled', 'escalated', 'closed')),
  submitted_at            timestamptz not null default now(),
  submission_key          uuid not null unique                                -- K-17
);

create index request_queue_idx on request (service_id, triage_level_id desc, submitted_at asc);
create index request_student_idx on request (student_id, submitted_at desc);

-- K-11: status is the only mutable request data
create function request_content_immutable() returns trigger language plpgsql as $$
begin
  if (new.id, new.student_id, new.service_id, new.structured_description, new.free_text,
      new.preferred_times, new.triage_level_id, new.submitted_at, new.submission_key)
     is distinct from
     (old.id, old.student_id, old.service_id, old.structured_description, old.free_text,
      old.preferred_times, old.triage_level_id, old.submitted_at, old.submission_key)
  then
    raise exception 'request content is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger request_immutable_content
  before update on request
  for each row execute function request_content_immutable();

-- ---------------------------------------------------------------------------
-- RequestStatusChange — append-only history (FR-12, K-12)
-- ---------------------------------------------------------------------------
create table request_status_change (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references request (id) on delete restrict,
  new_status  text not null check (new_status in ('submitted', 'in_review', 'handled', 'escalated', 'closed')),
  actor_id    uuid not null references app_user (id) on delete restrict,
  changed_at  timestamptz not null default now()
);

create index request_status_change_request_idx on request_status_change (request_id, changed_at desc);

create trigger request_status_change_append_only
  before update or delete on request_status_change
  for each row execute function forbid_change();

-- ---------------------------------------------------------------------------
-- Slot — openness is derived, never stored (K-3)
-- ---------------------------------------------------------------------------
create table slot (
  id               uuid primary key default gen_random_uuid(),
  practitioner_id  uuid not null references app_user (id) on delete restrict,
  start_at         timestamptz not null,
  unique (practitioner_id, start_at)
);

-- ---------------------------------------------------------------------------
-- Appointment
-- ---------------------------------------------------------------------------
create table appointment (
  id                     uuid primary key default gen_random_uuid(),   -- random v4: doubles as the opaque reminder reference
  request_id             uuid not null references request (id) on delete restrict,
  slot_id                uuid not null references slot (id) on delete restrict,
  student_id             uuid not null references app_user (id) on delete restrict,
  status                 text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at             timestamptz not null default now(),
  cancelled_at           timestamptz,
  reminder_published_at  timestamptz                                   -- K-14 set-once marker
);

-- K-1 / K-2: the storage layer decides the race, not application code
create unique index appointment_one_active_per_slot    on appointment (slot_id)    where status = 'confirmed';
create unique index appointment_one_active_per_request on appointment (request_id) where status = 'confirmed';
create index appointment_student_idx on appointment (student_id);

-- ---------------------------------------------------------------------------
-- AuditEvent — append-only, content-free (FR-11, K-13). Mock S&C sink at MVP.
-- ---------------------------------------------------------------------------
create table audit_event (
  id           bigint generated always as identity primary key,
  viewer_id    uuid not null references app_user (id) on delete restrict,
  viewer_role  text not null,
  request_id   uuid not null references request (id) on delete restrict,
  viewed_at    timestamptz not null default now()
);

create trigger audit_event_append_only
  before update or delete on audit_event
  for each row execute function forbid_change();

-- ---------------------------------------------------------------------------
-- OutboundEvent — transactional outbox (NFR-17, K-18..K-20). Deliberately FK-free.
-- ---------------------------------------------------------------------------
create function jsonb_sorted_keys(j jsonb) returns text[]
  language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(j) as k
$$;

create table outbound_event (
  event_id         uuid primary key default gen_random_uuid(),
  type             text not null check (type in ('appointment.reminder', 'appointment.cancelled')),
  reference        uuid not null,
  subject          text,            -- nulled on delivery (K-19)
  payload          jsonb,           -- nulled on delivery (K-19)
  occurred_at      timestamptz not null default now(),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_status      integer,
  delivered_at     timestamptz,
  failed_at        timestamptz,
  unique (reference, type),                                            -- K-18
  -- NFR-06 allowlist, enforced a second time at the storage layer
  check (
    payload is null
    or (type = 'appointment.reminder'  and jsonb_sorted_keys(payload) = array['appointmentAt', 'message', 'reference'])
    or (type = 'appointment.cancelled' and jsonb_sorted_keys(payload) = array['reference'])
  )
);

create index outbound_event_pending_idx on outbound_event (next_attempt_at)
  where delivered_at is null and failed_at is null;

-- ---------------------------------------------------------------------------
-- InboundEvent — webhook receiver log; primary key makes consumption idempotent
-- ---------------------------------------------------------------------------
create table inbound_event (
  event_id     uuid primary key,
  source       text not null,
  type         text not null,
  reference    uuid,
  occurred_at  timestamptz,
  received_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI call budget — one row per day, no per-visitor identifier (NFR-19)
-- ---------------------------------------------------------------------------
create table ai_call_budget (
  day    date primary key,
  calls  integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Deny-all RLS backstop: RLS on, ZERO policies, and no grants to browser roles.
-- The route-handler layer (service role) is the only data path (PRD Section 9).
-- ---------------------------------------------------------------------------
alter table triage_level          enable row level security;
alter table service               enable row level security;
alter table app_user              enable row level security;
alter table request               enable row level security;
alter table request_status_change enable row level security;
alter table slot                  enable row level security;
alter table appointment           enable row level security;
alter table audit_event           enable row level security;
alter table outbound_event        enable row level security;
alter table inbound_event         enable row level security;
alter table ai_call_budget        enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
