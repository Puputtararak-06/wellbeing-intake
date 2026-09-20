-- Transactional operations. Each function is one unit of work, so the multi-step
-- invariants (K-4, K-5, K-7, K-12, K-13, K-18) cannot be half-applied.
-- Functions return a result code instead of raising, so the route layer can shape
-- content-free responses (NFR-02, NFR-07).

-- ---------------------------------------------------------------------------
-- create_request — idempotent on submission_key (K-17)
-- ---------------------------------------------------------------------------
create function create_request(
  p_student        uuid,
  p_service        uuid,
  p_description    text,
  p_free_text      text,
  p_preferred      text,
  p_triage         smallint,
  p_submission_key uuid
) returns jsonb language plpgsql as $$
declare
  v_id      uuid;
  v_created boolean := false;
  v_row     request%rowtype;
begin
  insert into request (student_id, service_id, structured_description, free_text,
                       preferred_times, triage_level_id, submission_key)
  values (p_student, p_service, p_description, nullif(p_free_text, ''), p_preferred, p_triage, p_submission_key)
  on conflict (submission_key) do nothing
  returning id into v_id;

  if v_id is not null then
    v_created := true;
    insert into request_status_change (request_id, new_status, actor_id)
    values (v_id, 'submitted', p_student);
  end if;

  select * into v_row from request where submission_key = p_submission_key;

  -- a replayed key must belong to the same student; otherwise reveal nothing
  if v_row.student_id is distinct from p_student then
    return jsonb_build_object('code', 'not_found');
  end if;

  return jsonb_build_object(
    'code', 'ok',
    'created', v_created,
    'id', v_row.id,
    'status', v_row.status,
    'triage_level_id', v_row.triage_level_id,
    'submitted_at', v_row.submitted_at
  );
end $$;

-- ---------------------------------------------------------------------------
-- read_request_content — the ONLY path returning content to a non-owner.
-- Audit insert + first-read transition + select, one transaction (K-13, BR-08).
-- ---------------------------------------------------------------------------
create function read_request_content(p_request uuid, p_viewer uuid)
returns jsonb language plpgsql as $$
declare
  v_viewer app_user%rowtype;
  v_req    request%rowtype;
begin
  select * into v_viewer from app_user where id = p_viewer;
  if not found or v_viewer.role <> 'practitioner' then
    return null;
  end if;

  select * into v_req from request where id = p_request for update;
  if not found or v_req.service_id <> v_viewer.service_id then
    return null;                       -- indistinguishable from absent (NFR-02)
  end if;

  insert into audit_event (viewer_id, viewer_role, request_id)
  values (v_viewer.id, v_viewer.role, v_req.id);

  if v_req.status = 'submitted' then
    update request set status = 'in_review' where id = v_req.id;
    insert into request_status_change (request_id, new_status, actor_id)
    values (v_req.id, 'in_review', v_viewer.id);
    v_req.status := 'in_review';
  end if;

  return jsonb_build_object(
    'id', v_req.id,
    'service_id', v_req.service_id,
    'structured_description', v_req.structured_description,
    'free_text', v_req.free_text,
    'preferred_times', v_req.preferred_times,
    'triage_level_id', v_req.triage_level_id,
    'status', v_req.status,
    'submitted_at', v_req.submitted_at
  );
end $$;

-- ---------------------------------------------------------------------------
-- update_request_status — practitioner, own service, fixed lifecycle (FR-12, K-10)
-- Manual transitions: submitted|in_review -> escalated|closed. Nothing else.
-- ---------------------------------------------------------------------------
create function update_request_status(p_request uuid, p_actor uuid, p_new_status text)
returns text language plpgsql as $$
declare
  v_actor app_user%rowtype;
  v_req   request%rowtype;
begin
  select * into v_actor from app_user where id = p_actor;
  if not found or v_actor.role <> 'practitioner' then
    return 'not_found';
  end if;

  select * into v_req from request where id = p_request for update;
  if not found or v_req.service_id <> v_actor.service_id then
    return 'not_found';
  end if;

  if p_new_status not in ('escalated', 'closed')
     or v_req.status not in ('submitted', 'in_review') then
    return 'invalid_transition';
  end if;

  update request set status = p_new_status where id = v_req.id;
  insert into request_status_change (request_id, new_status, actor_id)
  values (v_req.id, p_new_status, v_actor.id);
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------
-- book_appointment — atomic booking (K-4) with consistency checks (K-8, K-9)
-- ---------------------------------------------------------------------------
create function book_appointment(p_student uuid, p_request uuid, p_slot uuid)
returns jsonb language plpgsql as $$
declare
  v_req         request%rowtype;
  v_slot        slot%rowtype;
  v_slot_service uuid;
  v_rank        smallint;
  v_appt        uuid;
begin
  select * into v_req from request where id = p_request for update;
  if not found or v_req.student_id <> p_student then
    return jsonb_build_object('code', 'not_found');
  end if;

  select s.* into v_slot from slot s where s.id = p_slot for update;
  if not found then
    return jsonb_build_object('code', 'not_found');
  end if;

  select u.service_id into v_slot_service from app_user u where u.id = v_slot.practitioner_id;
  if v_slot_service is distinct from v_req.service_id then
    return jsonb_build_object('code', 'not_found');
  end if;

  select rank into v_rank from triage_level where id = v_req.triage_level_id;
  if v_req.status <> 'in_review' or v_rank = 3 then
    return jsonb_build_object('code', 'request_not_bookable');     -- BR-10
  end if;

  if v_slot.start_at <= now() then                                  -- server clock (K-9)
    return jsonb_build_object('code', 'slot_taken');
  end if;

  begin
    insert into appointment (request_id, slot_id, student_id)
    values (v_req.id, v_slot.id, p_student)
    returning id into v_appt;
  exception when unique_violation then
    return jsonb_build_object('code', 'slot_taken');                -- K-1 / K-2 decided the race
  end;

  update request set status = 'handled' where id = v_req.id;        -- BR-11
  insert into request_status_change (request_id, new_status, actor_id)
  values (v_req.id, 'handled', p_student);

  return jsonb_build_object('code', 'ok', 'appointment_id', v_appt, 'start_at', v_slot.start_at);
end $$;

-- ---------------------------------------------------------------------------
-- cancel_appointment — atomic (K-5); retraction owed iff a reminder went out (BR-25)
-- ---------------------------------------------------------------------------
create function cancel_appointment(p_student uuid, p_appointment uuid)
returns jsonb language plpgsql as $$
declare
  v_reminded timestamptz;
  v_subject  text;
  v_found    boolean := false;
begin
  update appointment a
     set status = 'cancelled', cancelled_at = now()
    from slot s
   where a.id = p_appointment
     and a.student_id = p_student
     and a.status = 'confirmed'
     and s.id = a.slot_id
     and s.start_at > now()
  returning a.reminder_published_at, true into v_reminded, v_found;

  if not coalesce(v_found, false) then
    return jsonb_build_object('code', 'not_found');
  end if;

  if v_reminded is not null then
    -- reminder_published_at is set when the reminder is ENQUEUED, so it may still be waiting
    -- (or backing off after a failed attempt). Neutralise it here, in the same transaction:
    -- parked and stripped of recipient and payload, it can never be delivered later. The
    -- retraction is still written in case an attempt is in flight right now (BR-25).
    update outbound_event
       set failed_at = now(), subject = null, payload = null
     where reference = p_appointment
       and type = 'appointment.reminder'
       and delivered_at is null;

    select 'student:' || identity_ref into v_subject from app_user where id = p_student;
    insert into outbound_event (type, reference, subject, payload)
    values ('appointment.cancelled', p_appointment, v_subject,
            jsonb_build_object('reference', p_appointment))
    on conflict (reference, type) do nothing;
  end if;

  return jsonb_build_object('code', 'ok', 'retraction_enqueued', v_reminded is not null);
end $$;

-- ---------------------------------------------------------------------------
-- enqueue_due_reminders — marker + outbox row in one statement (K-14, K-18).
-- Only appointments still confirmed at this moment are considered.
-- ---------------------------------------------------------------------------
create function enqueue_due_reminders(p_lead interval, p_message text)
returns integer language plpgsql as $$
declare
  v_count integer;
begin
  with due as (
    update appointment a
       set reminder_published_at = now()
      from slot s, app_user u
     where s.id = a.slot_id
       and u.id = a.student_id
       and a.status = 'confirmed'
       and a.reminder_published_at is null
       and s.start_at > now()
       and s.start_at <= now() + p_lead
    returning a.id, s.start_at, u.identity_ref
  ), ins as (
    insert into outbound_event (type, reference, subject, payload)
    select 'appointment.reminder', d.id, 'student:' || d.identity_ref,
           jsonb_build_object(
             'appointmentAt', to_char(d.start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'message', p_message,
             'reference', d.id)
      from due d
    on conflict (reference, type) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Outbox delivery state (K-19)
-- ---------------------------------------------------------------------------
create function claim_outbound_events(p_limit integer, p_lease interval)
returns setof outbound_event language plpgsql as $$
begin
  return query
  update outbound_event o
     set attempts = o.attempts + 1,
         next_attempt_at = now() + p_lease          -- lease: a concurrent dispatcher skips it
   where o.event_id in (
           select e.event_id from outbound_event e
            where e.delivered_at is null and e.failed_at is null and e.next_attempt_at <= now()
            order by e.next_attempt_at
            limit p_limit
            for update skip locked)
  returning o.*;
end $$;

create function mark_outbound_delivered(p_event uuid, p_status integer)
returns void language sql as $$
  update outbound_event
     set delivered_at = now(), last_status = p_status, subject = null, payload = null
   where event_id = p_event and delivered_at is null;
$$;

create function mark_outbound_attempt_failed(
  p_event uuid, p_status integer, p_base interval, p_max_attempts integer
) returns jsonb language plpgsql as $$
declare
  v_row outbound_event%rowtype;
begin
  update outbound_event
     set last_status = p_status,
         next_attempt_at = now() + (p_base * power(2, greatest(attempts - 1, 0))),
         failed_at = case when attempts >= p_max_attempts then now() else null end
   -- `failed_at is null`: never un-park a row that cancellation has neutralised
   where event_id = p_event and delivered_at is null and failed_at is null
  returning * into v_row;
  return jsonb_build_object('attempts', v_row.attempts,
                            'next_attempt_at', v_row.next_attempt_at,
                            'parked', v_row.failed_at is not null);
end $$;

-- ---------------------------------------------------------------------------
-- remove_slot — only while unbooked, checked atomically (K-7)
-- ---------------------------------------------------------------------------
create function remove_slot(p_practitioner uuid, p_slot uuid)
returns text language plpgsql as $$
declare
  v_slot slot%rowtype;
begin
  select * into v_slot from slot where id = p_slot for update;
  if not found or v_slot.practitioner_id <> p_practitioner then
    return 'not_found';
  end if;
  if exists (select 1 from appointment where slot_id = p_slot and status = 'confirmed') then
    return 'booked';
  end if;
  delete from appointment where slot_id = p_slot and status = 'cancelled';
  delete from slot where id = p_slot;
  return 'ok';
end $$;

-- ---------------------------------------------------------------------------
-- record_inbound_event — true only the first time an eventId is seen
-- ---------------------------------------------------------------------------
create function record_inbound_event(
  p_event uuid, p_source text, p_type text, p_reference uuid, p_occurred timestamptz
) returns boolean language plpgsql as $$
declare
  v_inserted uuid;
begin
  insert into inbound_event (event_id, source, type, reference, occurred_at)
  values (p_event, p_source, p_type, p_reference, p_occurred)
  on conflict (event_id) do nothing
  returning event_id into v_inserted;
  return v_inserted is not null;
end $$;

-- ---------------------------------------------------------------------------
-- consume_ai_budget — global daily cap, no visitor identifier (NFR-19)
-- ---------------------------------------------------------------------------
create function consume_ai_budget(p_limit integer)
returns boolean language plpgsql as $$
declare
  v_calls integer;
begin
  if p_limit < 1 then
    return false;
  end if;
  insert into ai_call_budget (day, calls) values (current_date, 1)
  on conflict (day) do update set calls = ai_call_budget.calls + 1
    where ai_call_budget.calls < p_limit
  returning calls into v_calls;
  return v_calls is not null and v_calls <= p_limit;
end $$;

-- ---------------------------------------------------------------------------
-- reset_demo_data — NFR-09 whole-dataset destruction (seed script reloads fixtures)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: truncating with RESTART IDENTITY needs ownership of the sequences, which
-- the service role does not have. Execution is still granted to the service role only.
create function reset_demo_data() returns void
  language plpgsql security definer set search_path = public as $$
begin
  truncate table audit_event, request_status_change, appointment, slot, request,
                 outbound_event, inbound_event, ai_call_budget, app_user, service
    restart identity cascade;
end $$;

-- Browser-facing roles can execute nothing; only the server's service role can.
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on all functions in schema public to service_role;
