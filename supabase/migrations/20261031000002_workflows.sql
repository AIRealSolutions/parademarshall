-- =============================================================================
-- Parade Management System — Workflow functions and business-rule enforcement
--
-- Every state-changing operational action goes through a SECURITY DEFINER
-- function that checks the caller's event role, validates the transition,
-- and leaves an audit trail. Direct table writes to status columns are blocked.
-- Spec references: FR-02, FR-03, FR-04, FR-06, FR-07, §6 critical business rules.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Guards: status columns change only through workflow functions.
-- (Same pattern as guard_application_fields: SECURITY INVOKER, so a direct
-- client write runs as "authenticated" while workflow functions run as owner.)
-- -----------------------------------------------------------------------------

create function public.guard_unit_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and new.status is distinct from old.status then
    raise exception 'Unit status changes only through the check-in and dispatch functions'
      using errcode = '42501';
  end if;
  if current_user in ('authenticated', 'anon') and new.pass_token is distinct from old.pass_token then
    raise exception 'Use reissue_unit_pass() to replace a pass' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger parade_units_guard before update on public.parade_units
  for each row execute function public.guard_unit_status();

create function public.guard_event_hold() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.parade_hold is distinct from old.parade_hold
       or new.parade_hold_reason is distinct from old.parade_hold_reason
       or new.parade_hold_by is distinct from old.parade_hold_by
       or new.parade_hold_at is distinct from old.parade_hold_at) then
    raise exception 'Use set_parade_hold() for parade-wide hold and resume' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger events_guard_hold before update on public.events
  for each row execute function public.guard_event_hold();

-- -----------------------------------------------------------------------------
-- Notifications helper
-- -----------------------------------------------------------------------------

create function public.notify_event_directors(
  p_event_id uuid, p_subject text, p_body text, p_related_table text, p_related_id uuid
) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (event_id, recipient_id, channel, subject, body, related_table, related_id)
  select distinct p_event_id, r.user_id, 'in_app'::public.notification_channel,
         p_subject, p_body, p_related_table, p_related_id
  from public.event_roles r
  where r.event_id = p_event_id and r.role in ('parade_director', 'assistant_director');
$$;

-- -----------------------------------------------------------------------------
-- FR-02: application lifecycle
-- -----------------------------------------------------------------------------

-- Who may perform each transition: 'owner' (submitter/org member), 'reviewer'
-- (coordinator, assistant, director) or 'director' (director/assistant).
-- Mirrored in src/lib/domain/applications.ts for the UI; this table is authoritative.
create function public.application_transition_actor(
  p_from public.application_status, p_to public.application_status
) returns text
language sql immutable as $$
  select case
    when p_from = 'draft'             and p_to = 'submitted'         then 'owner'
    when p_from = 'needs_information' and p_to = 'submitted'         then 'owner'
    when p_from = 'submitted'         and p_to = 'under_review'      then 'reviewer'
    when p_from in ('submitted', 'under_review') and p_to = 'needs_information' then 'reviewer'
    when p_from in ('submitted', 'under_review', 'approved') and p_to = 'waitlisted' then 'reviewer'
    when p_from in ('under_review', 'waitlisted') and p_to = 'approved' then 'director'
    when p_from in ('submitted', 'under_review', 'needs_information', 'waitlisted')
                                      and p_to = 'rejected'          then 'director'
    when p_from = 'approved'          and p_to = 'assigned'          then 'director'
    when p_from = 'assigned'          and p_to = 'approved'          then 'director'
    when p_from = 'assigned'          and p_to = 'no_show'           then 'director'
    when p_from in ('assigned', 'checked_in') and p_to = 'completed' then 'director'
    when p_from in ('draft', 'submitted', 'under_review', 'needs_information', 'approved',
                    'waitlisted', 'assigned')
                                      and p_to = 'withdrawn'         then 'owner_or_director'
    else null
  end;
$$;

create function public.registration_is_open(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select e.status = 'registration_open'
       and (e.registration_opens_at is null or e.registration_opens_at <= now())
       and (e.registration_closes_at is null or e.registration_closes_at > now())
    from public.events e where e.id = p_event_id
  ), false);
$$;

-- Total occupied length for an application's vehicles (towing + trailer).
create function public.application_vehicle_length(p_application_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(v.length_ft + v.trailer_length_ft), 0)
  from public.vehicles v where v.application_id = p_application_id;
$$;

create function public.transition_application(
  p_application_id uuid, p_to public.application_status, p_note text default null
) returns public.applications
language plpgsql security definer set search_path = public as $$
declare
  v_app public.applications;
  v_actor text;
  v_is_owner boolean;
  v_allowed boolean;
  v_waiver public.waivers;
  v_event public.events;
  v_length numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_app from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  select * into v_event from public.events where id = v_app.event_id;

  v_actor := public.application_transition_actor(v_app.status, p_to);
  if v_actor is null then
    raise exception 'Invalid application transition: % -> %', v_app.status, p_to using errcode = '22023';
  end if;

  v_is_owner := v_app.submitted_by = auth.uid() or public.is_org_member(v_app.organization_id);
  v_allowed := case v_actor
    when 'owner' then v_is_owner
    when 'reviewer' then public.is_event_reviewer(v_app.event_id)
    when 'director' then public.is_event_director(v_app.event_id)
    when 'owner_or_director' then v_is_owner or public.is_event_director(v_app.event_id)
  end;
  if not v_allowed then
    raise exception 'Not permitted to move application from % to %', v_app.status, p_to
      using errcode = '42501';
  end if;

  if (p_to in ('needs_information', 'rejected', 'no_show') or (v_app.status = 'assigned' and p_to = 'approved'))
     and coalesce(trim(p_note), '') = '' then
    raise exception 'A note explaining this change is required' using errcode = '22023';
  end if;

  -- Submission prerequisites.
  if p_to = 'submitted' then
    if not public.registration_is_open(v_app.event_id) then
      raise exception 'Registration is not open for this event' using errcode = '22023';
    end if;
    select * into v_waiver from public.waivers
      where event_id = v_app.event_id and is_active and is_required
      order by version desc limit 1;
    if v_waiver.id is not null and (v_app.waiver_id is distinct from v_waiver.id
                                    or v_app.waiver_accepted_at is null) then
      raise exception 'The current required waiver must be accepted before submitting'
        using errcode = '22023';
    end if;
    if v_app.category_id is null then
      raise exception 'A parade category is required' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.audit_context', format('transition %s -> %s', v_app.status, p_to), true);

  update public.applications set
    status = p_to,
    status_note = coalesce(p_note, case when p_to = 'submitted' then null else status_note end),
    submitted_at = case when p_to = 'submitted' then now() else submitted_at end,
    reviewed_by = case when v_actor in ('reviewer', 'director') then auth.uid() else reviewed_by end,
    reviewed_at = case when v_actor in ('reviewer', 'director') then now() else reviewed_at end
  where id = p_application_id
  returning * into v_app;

  -- Approval creates the dispatchable unit; the director may split it later.
  if p_to = 'approved' and not exists (select 1 from public.parade_units where application_id = v_app.id) then
    v_length := greatest(v_app.footprint_length_ft, public.application_vehicle_length(v_app.id));
    insert into public.parade_units (event_id, application_id, name, category_id,
                                     footprint_length_ft, footprint_width_ft, separation_ft)
    values (v_app.event_id, v_app.id, coalesce(nullif(v_app.public_name, ''), v_app.entry_name),
            v_app.category_id, v_length, v_app.footprint_width_ft, v_event.default_separation_ft);
    update public.vehicles set unit_id = (select id from public.parade_units where application_id = v_app.id limit 1)
      where application_id = v_app.id and unit_id is null;
  end if;

  if p_to in ('withdrawn', 'rejected', 'no_show', 'waitlisted') then
    update public.staging_assignments set status = 'released'
      where unit_id in (select id from public.parade_units where application_id = v_app.id)
        and status <> 'released';
  end if;
  if p_to in ('withdrawn', 'rejected') then
    update public.parade_units set status = 'withdrawn', sequence_number = null
      where application_id = v_app.id and status not in ('finished', 'withdrawn');
  end if;

  -- Notify the participant (delivery handled by the notifications worker).
  if v_actor <> 'owner' then
    insert into public.notifications (event_id, recipient_id, channel, subject, body, related_table, related_id)
    values (v_app.event_id, v_app.submitted_by, 'email',
            format('%s: application %s', v_event.name, replace(p_to::text, '_', ' ')),
            coalesce(p_note, format('Your entry "%s" is now %s.', v_app.entry_name, replace(p_to::text, '_', ' '))),
            'applications', v_app.id);
  elsif p_to = 'submitted' then
    perform public.notify_event_directors(v_app.event_id, 'New parade application',
      format('"%s" was submitted for review.', v_app.entry_name), 'applications', v_app.id);
  end if;

  return v_app;
end $$;

-- -----------------------------------------------------------------------------
-- FR-03 / FR-04: staging placement rules
-- -----------------------------------------------------------------------------

-- Effective status of a block now: the most severe of its base status and any
-- active restriction on the block, its lane or its zone.
create function public.block_effective_status(p_block_id uuid, p_at timestamptz default now())
returns public.segment_status
language sql stable security definer set search_path = public as $$
  with b as (
    select b.id, b.base_status, b.lane_id, l.zone_id
    from public.staging_blocks b join public.staging_lanes l on l.id = b.lane_id
    where b.id = p_block_id
  ), statuses as (
    select base_status as s from b
    union all
    select r.status from public.restrictions r, b
    where (r.block_id = b.id or r.lane_id = b.lane_id or r.zone_id = b.zone_id)
      and r.effective_from <= p_at and (r.effective_to is null or r.effective_to > p_at)
  )
  select s from statuses
  order by case s when 'unavailable' then 4 when 'temporarily_closed' then 3
                  when 'restricted' then 2 else 1 end desc
  limit 1;
$$;

-- True if a safety restriction (not overridable by the director) covers the block now.
create function public.block_has_safety_restriction(p_block_id uuid, p_at timestamptz default now())
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staging_blocks b
    join public.staging_lanes l on l.id = b.lane_id
    join public.restrictions r on (r.block_id = b.id or r.lane_id = b.lane_id or r.zone_id = l.zone_id)
    where b.id = p_block_id and r.is_safety
      and r.effective_from <= p_at and (r.effective_to is null or r.effective_to > p_at)
  );
$$;

create function public.validate_staging_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_unit public.parade_units;
  v_block public.staging_blocks;
  v_block_event uuid;
  v_status public.segment_status;
begin
  -- Flagging and releasing never need placement validation; they only remove risk.
  if new.status in ('flagged', 'released') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.block_id = old.block_id and new.start_offset_ft = old.start_offset_ft
     and new.occupied_length_ft = old.occupied_length_ft and new.status = old.status then
    return new;
  end if;

  select * into v_unit from public.parade_units where id = new.unit_id;
  select * into v_block from public.staging_blocks where id = new.block_id;
  select z.event_id into v_block_event
    from public.staging_lanes l join public.staging_zones z on z.id = l.zone_id where l.id = v_block.lane_id;

  if v_unit.event_id <> new.event_id or v_block_event <> new.event_id then
    raise exception 'Unit, block and assignment must belong to the same event' using errcode = '22023';
  end if;
  if v_unit.status in ('withdrawn', 'finished') then
    raise exception 'Unit % is % and cannot be staged', v_unit.name, v_unit.status using errcode = '22023';
  end if;

  v_status := public.block_effective_status(new.block_id);
  if v_status in ('temporarily_closed', 'unavailable') then
    raise exception 'Staging block is % and cannot receive units', v_status using errcode = '22023';
  end if;
  if v_status = 'restricted' then
    if public.block_has_safety_restriction(new.block_id) then
      raise exception 'Staging block has an active safety restriction; change the approved operational plan first'
        using errcode = '22023';
    end if;
    if coalesce(trim(new.override_reason), '') = '' then
      raise exception 'Staging block is restricted; a documented override reason is required'
        using errcode = '22023';
    end if;
  end if;

  -- Complete occupied footprint including separation allowance (§6).
  if new.occupied_length_ft < v_unit.footprint_length_ft + v_unit.separation_ft then
    raise exception 'Occupied length % ft is less than unit footprint % ft plus % ft separation',
      new.occupied_length_ft, v_unit.footprint_length_ft, v_unit.separation_ft using errcode = '22023';
  end if;
  if new.start_offset_ft + new.occupied_length_ft > v_block.usable_length_ft then
    raise exception 'Unit needs % ft but only % ft is usable from offset % ft',
      new.occupied_length_ft, v_block.usable_length_ft - new.start_offset_ft, new.start_offset_ft
      using errcode = '22023';
  end if;
  if v_unit.footprint_width_ft > v_block.permitted_width_ft then
    raise exception 'Unit width % ft exceeds permitted block width % ft',
      v_unit.footprint_width_ft, v_block.permitted_width_ft using errcode = '22023';
  end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    new.approved_by := auth.uid();
    new.approved_at := now();
  end if;
  return new;
end $$;

create trigger staging_assignments_validate before insert or update on public.staging_assignments
  for each row execute function public.validate_staging_assignment();

-- A new or changed restriction flags affected assignments for director review.
-- It never relocates units or sends participant instructions (FR-04).
create function public.flag_assignments_for_restriction() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if new.effective_to is not null and new.effective_to <= now() then
    return null;
  end if;
  with affected as (
    select a.id from public.staging_assignments a
    join public.staging_blocks b on b.id = a.block_id
    join public.staging_lanes l on l.id = b.lane_id
    where a.status in ('proposed', 'approved')
      and (b.id = new.block_id or l.id = new.lane_id or l.zone_id = new.zone_id)
  )
  update public.staging_assignments a
     set status = 'flagged',
         flag_reason = format('Restriction (%s): %s', new.status, new.reason)
    from affected where a.id = affected.id;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform public.notify_event_directors(new.event_id,
      'Staging restriction affects assigned units',
      format('%s assignment(s) flagged for reassignment: %s', v_count, new.reason),
      'restrictions', new.id);
  end if;
  return null;
end $$;

create trigger restrictions_flag after insert or update on public.restrictions
  for each row execute function public.flag_assignments_for_restriction();

-- Director approves a placement and, when all of the unit's placements are
-- approved, the application advances to "assigned".
create function public.approve_staging_assignment(p_assignment_id uuid, p_override_reason text default null)
returns public.staging_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_a public.staging_assignments;
  v_app_id uuid;
begin
  select * into v_a from public.staging_assignments where id = p_assignment_id for update;
  if not found then raise exception 'Assignment not found' using errcode = 'P0002'; end if;
  if not public.is_event_director(v_a.event_id) then
    raise exception 'Only the Parade Director or delegated assistant may approve placement'
      using errcode = '42501';
  end if;
  update public.staging_assignments
     set status = 'approved', override_reason = coalesce(p_override_reason, override_reason), flag_reason = null
   where id = p_assignment_id returning * into v_a;

  select application_id into v_app_id from public.parade_units where id = v_a.unit_id;
  if v_app_id is not null then
    update public.applications set status = 'assigned'
     where id = v_app_id and status = 'approved'
       and not exists (
         select 1 from public.parade_units u
         where u.application_id = v_app_id and u.status <> 'withdrawn'
           and not exists (select 1 from public.staging_assignments s
                           where s.unit_id = u.id and s.status = 'approved'));
  end if;
  return v_a;
end $$;

-- -----------------------------------------------------------------------------
-- FR-06: check-in and dispatch
-- -----------------------------------------------------------------------------

create function public.log_dispatch_event(
  p_event_id uuid, p_unit_id uuid, p_action public.dispatch_action,
  p_from public.unit_status, p_to public.unit_status, p_reason text,
  p_client_action_id uuid, p_recorded_at timestamptz, p_requires_resolution boolean default false
) returns uuid
language sql security definer set search_path = public as $$
  insert into public.dispatch_events (event_id, unit_id, action, from_status, to_status, reason,
                                      performed_by, recorded_at, client_action_id, requires_resolution)
  values (p_event_id, p_unit_id, p_action, p_from, p_to, p_reason, auth.uid(),
          coalesce(p_recorded_at, now()), p_client_action_id, p_requires_resolution)
  returning id;
$$;

-- Returns the stored result for an already-synchronized offline action, if any.
create function public.prior_dispatch_result(p_client_action_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', not d.requires_resolution, 'duplicate', true, 'dispatch_event_id', d.id,
                            'unit_id', d.unit_id, 'status', d.to_status, 'escalated', d.requires_resolution)
  from public.dispatch_events d where p_client_action_id is not null and d.client_action_id = p_client_action_id;
$$;

-- Marshal-level unit status changes (staging area).
create function public.unit_transition_allowed(p_from public.unit_status, p_to public.unit_status)
returns boolean
language sql immutable as $$
  select (p_from, p_to) in (
    ('not_arrived', 'checked_in'),
    ('checked_in', 'staged'), ('checked_in', 'ready'),
    ('staged', 'ready'),
    ('ready', 'staged'),
    ('not_arrived', 'held'), ('checked_in', 'held'), ('staged', 'held'), ('ready', 'held'),
    ('held', 'checked_in'), ('held', 'staged'), ('held', 'ready'),
    ('not_arrived', 'skipped'), ('checked_in', 'skipped'), ('staged', 'skipped'),
    ('ready', 'skipped'), ('held', 'skipped'),
    ('checked_in', 'incident'), ('staged', 'incident'), ('ready', 'incident'),
    ('authorized', 'incident'), ('released', 'incident'), ('on_route', 'incident'),
    ('incident', 'held'), ('incident', 'ready'), ('incident', 'on_route')
  );
$$;

create function public.check_in_unit(
  p_pass_token text, p_client_action_id uuid default null, p_recorded_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_unit public.parade_units;
  v_prior jsonb;
  v_event_id uuid;
begin
  v_prior := public.prior_dispatch_result(p_client_action_id);
  if v_prior is not null then return v_prior; end if;

  select * into v_unit from public.parade_units where pass_token = p_pass_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Pass not recognized');
  end if;
  if not public.has_event_role(v_unit.event_id, array['parade_director', 'assistant_director',
       'staging_marshal', 'dispatch_controller']::public.app_role[]) then
    raise exception 'Not permitted to check in units for this event' using errcode = '42501';
  end if;
  v_event_id := v_unit.event_id;

  if v_unit.status <> 'not_arrived' then
    return jsonb_build_object('ok', false, 'unit_id', v_unit.id, 'name', v_unit.name,
      'status', v_unit.status, 'reason', format('Unit is already %s', v_unit.status));
  end if;

  update public.parade_units set status = 'checked_in' where id = v_unit.id;
  update public.applications set status = 'checked_in'
   where id = v_unit.application_id and status = 'assigned';
  perform public.log_dispatch_event(v_event_id, v_unit.id, 'check_in', 'not_arrived', 'checked_in',
                                    'Check-in by pass scan', p_client_action_id, p_recorded_at);

  return jsonb_build_object('ok', true, 'unit_id', v_unit.id, 'name', v_unit.name,
    'sequence_number', v_unit.sequence_number, 'status', 'checked_in',
    'assignment', (
      select jsonb_build_object('zone', z.street_name, 'lane', l.lane_number, 'block', b.block_number,
                                'offset_ft', a.start_offset_ft)
      from public.staging_assignments a
      join public.staging_blocks b on b.id = a.block_id
      join public.staging_lanes l on l.id = b.lane_id
      join public.staging_zones z on z.id = l.zone_id
      where a.unit_id = v_unit.id and a.status <> 'released' limit 1));
end $$;

create function public.set_unit_status(
  p_unit_id uuid, p_to public.unit_status, p_reason text default null,
  p_client_action_id uuid default null, p_recorded_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_unit public.parade_units;
  v_prior jsonb;
begin
  v_prior := public.prior_dispatch_result(p_client_action_id);
  if v_prior is not null then return v_prior; end if;

  select * into v_unit from public.parade_units where id = p_unit_id for update;
  if not found then raise exception 'Unit not found' using errcode = 'P0002'; end if;
  if not public.has_event_role(v_unit.event_id, array['parade_director', 'assistant_director',
       'staging_marshal', 'dispatch_controller']::public.app_role[]) then
    raise exception 'Not permitted to change unit status' using errcode = '42501';
  end if;
  if not public.unit_transition_allowed(v_unit.status, p_to) then
    raise exception 'Invalid unit transition: % -> %', v_unit.status, p_to using errcode = '22023';
  end if;
  if p_to in ('held', 'skipped', 'incident') and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  update public.parade_units set status = p_to where id = p_unit_id;
  perform public.log_dispatch_event(v_unit.event_id, p_unit_id,
    case p_to when 'held' then 'hold_unit' when 'skipped' then 'skip' else 'status_change' end::public.dispatch_action,
    v_unit.status, p_to, p_reason, p_client_action_id, p_recorded_at);
  return jsonb_build_object('ok', true, 'unit_id', p_unit_id, 'status', p_to);
end $$;

-- Grant the single active release authorization at the merge.
-- Conflicts are recorded and escalated for human resolution, never auto-accepted.
create function public.authorize_unit(
  p_unit_id uuid, p_client_action_id uuid default null, p_recorded_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_unit public.parade_units;
  v_event public.events;
  v_active public.dispatch_authorizations;
  v_prior jsonb;
  v_reason text;
  v_event_log uuid;
begin
  v_prior := public.prior_dispatch_result(p_client_action_id);
  if v_prior is not null then return v_prior; end if;

  select * into v_unit from public.parade_units where id = p_unit_id for update;
  if not found then raise exception 'Unit not found' using errcode = 'P0002'; end if;
  -- Lock the event row: serializes all authorizations for this parade.
  select * into v_event from public.events where id = v_unit.event_id for update;
  if not public.has_event_role(v_event.id, array['parade_director', 'dispatch_controller']::public.app_role[]) then
    raise exception 'Only the dispatch controller or director may authorize release' using errcode = '42501';
  end if;

  select * into v_active from public.dispatch_authorizations where event_id = v_event.id and is_active;

  v_reason := case
    when v_event.parade_hold then 'Parade-wide hold is in effect'
    when v_active.id is not null and v_active.unit_id = p_unit_id then 'Unit already holds the active authorization'
    when v_active.id is not null then 'Another unit holds the active authorization'
    when v_unit.status <> 'ready' then format('Unit is %s, not ready', v_unit.status)
  end;

  if v_reason is not null then
    v_event_log := public.log_dispatch_event(v_event.id, p_unit_id, 'conflict', v_unit.status, v_unit.status,
      'Authorization refused: ' || v_reason, p_client_action_id, p_recorded_at,
      p_client_action_id is not null);
    return jsonb_build_object('ok', false, 'reason', v_reason, 'dispatch_event_id', v_event_log,
                              'escalated', p_client_action_id is not null);
  end if;

  insert into public.dispatch_authorizations (event_id, unit_id, authorized_by)
  values (v_event.id, p_unit_id, auth.uid());
  update public.parade_units set status = 'authorized' where id = p_unit_id;
  v_event_log := public.log_dispatch_event(v_event.id, p_unit_id, 'authorize', 'ready', 'authorized',
                                           null, p_client_action_id, p_recorded_at);
  return jsonb_build_object('ok', true, 'unit_id', p_unit_id, 'status', 'authorized',
                            'dispatch_event_id', v_event_log);
end $$;

create function public.release_unit(
  p_unit_id uuid, p_client_action_id uuid default null, p_recorded_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_unit public.parade_units;
  v_event public.events;
  v_prior jsonb;
  v_reason text;
  v_log uuid;
begin
  v_prior := public.prior_dispatch_result(p_client_action_id);
  if v_prior is not null then return v_prior; end if;

  select * into v_unit from public.parade_units where id = p_unit_id for update;
  if not found then raise exception 'Unit not found' using errcode = 'P0002'; end if;
  select * into v_event from public.events where id = v_unit.event_id for update;
  if not public.has_event_role(v_event.id, array['parade_director', 'dispatch_controller']::public.app_role[]) then
    raise exception 'Only the dispatch controller or director may release units' using errcode = '42501';
  end if;

  v_reason := case
    when v_event.parade_hold then 'Parade-wide hold is in effect'
    when v_unit.status <> 'authorized' then format('Unit is %s, not authorized', v_unit.status)
    when not exists (select 1 from public.dispatch_authorizations
                     where unit_id = p_unit_id and is_active) then 'Unit has no active authorization'
  end;
  if v_reason is not null then
    v_log := public.log_dispatch_event(v_event.id, p_unit_id, 'conflict', v_unit.status, v_unit.status,
      'Release refused: ' || v_reason, p_client_action_id, p_recorded_at, p_client_action_id is not null);
    return jsonb_build_object('ok', false, 'reason', v_reason, 'dispatch_event_id', v_log,
                              'escalated', p_client_action_id is not null);
  end if;

  update public.dispatch_authorizations set is_active = false, closed_at = now(), closed_reason = 'released'
   where unit_id = p_unit_id and is_active;
  update public.parade_units set status = 'released' where id = p_unit_id;
  update public.staging_assignments set status = 'released' where unit_id = p_unit_id and status <> 'released';
  v_log := public.log_dispatch_event(v_event.id, p_unit_id, 'release', 'authorized', 'released',
                                     null, p_client_action_id, p_recorded_at);
  return jsonb_build_object('ok', true, 'unit_id', p_unit_id, 'status', 'released', 'dispatch_event_id', v_log);
end $$;

create function public.revoke_authorization(p_unit_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_unit public.parade_units;
begin
  select * into v_unit from public.parade_units where id = p_unit_id for update;
  if not found then raise exception 'Unit not found' using errcode = 'P0002'; end if;
  if not public.has_event_role(v_unit.event_id, array['parade_director', 'dispatch_controller']::public.app_role[]) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  update public.dispatch_authorizations set is_active = false, closed_at = now(), closed_reason = p_reason
   where unit_id = p_unit_id and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Unit has no active authorization');
  end if;
  update public.parade_units set status = 'ready' where id = p_unit_id and status = 'authorized';
  perform public.log_dispatch_event(v_unit.event_id, p_unit_id, 'revoke', v_unit.status, 'ready',
                                    p_reason, null, null);
  return jsonb_build_object('ok', true, 'unit_id', p_unit_id, 'status', 'ready');
end $$;

create function public.set_parade_hold(p_event_id uuid, p_hold boolean, p_reason text default null)
returns public.events
language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then raise exception 'Event not found' using errcode = 'P0002'; end if;
  if not public.has_event_role(p_event_id, array['parade_director', 'dispatch_controller',
       'public_safety_liaison']::public.app_role[]) then
    raise exception 'Not permitted to hold or resume the parade' using errcode = '42501';
  end if;
  if p_hold and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for a parade-wide hold' using errcode = '22023';
  end if;
  if v_event.parade_hold = p_hold then
    return v_event;
  end if;

  update public.events set
    parade_hold = p_hold,
    parade_hold_reason = case when p_hold then p_reason else null end,
    parade_hold_by = auth.uid(),
    parade_hold_at = now()
  where id = p_event_id returning * into v_event;
  perform public.log_dispatch_event(p_event_id, null,
    case when p_hold then 'parade_hold' else 'parade_resume' end::public.dispatch_action,
    null, null, p_reason, null, null);
  return v_event;
end $$;

-- -----------------------------------------------------------------------------
-- FR-07: checkpoint passage (marshal-reported, offline tolerant)
-- -----------------------------------------------------------------------------

create function public.record_checkpoint_passage(
  p_unit_id uuid, p_checkpoint_id uuid, p_recorded_at timestamptz,
  p_client_action_id uuid default null, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_unit public.parade_units;
  v_cp public.checkpoints;
  v_existing public.movement_events;
  v_new_status public.unit_status;
  v_conflict boolean := false;
  v_id uuid;
begin
  if p_client_action_id is not null then
    select * into v_existing from public.movement_events where client_action_id = p_client_action_id;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'movement_event_id', v_existing.id);
    end if;
  end if;

  select * into v_unit from public.parade_units where id = p_unit_id for update;
  if not found then raise exception 'Unit not found' using errcode = 'P0002'; end if;
  select * into v_cp from public.checkpoints where id = p_checkpoint_id;
  if not found or v_cp.event_id <> v_unit.event_id then
    raise exception 'Checkpoint not found for this event' using errcode = 'P0002';
  end if;
  if not public.has_event_role(v_unit.event_id, array['parade_director', 'assistant_director',
       'checkpoint_marshal', 'dispatch_controller']::public.app_role[]) then
    raise exception 'Not permitted to record checkpoint passage' using errcode = '42501';
  end if;

  select * into v_existing from public.movement_events where unit_id = p_unit_id and checkpoint_id = p_checkpoint_id;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'movement_event_id', v_existing.id);
  end if;

  insert into public.movement_events (event_id, unit_id, checkpoint_id, source, reported_by,
                                      recorded_at, client_action_id, notes)
  values (v_unit.event_id, p_unit_id, p_checkpoint_id, 'marshal', auth.uid(),
          coalesce(p_recorded_at, now()), p_client_action_id, p_notes)
  returning id into v_id;

  -- A passage observation is always kept, but a unit seen on the route
  -- without a recorded release is escalated rather than silently advanced.
  if v_unit.status in ('released', 'on_route', 'incident') then
    v_new_status := case when v_cp.is_finish then 'finished'
                         when v_unit.status = 'incident' then 'incident'
                         else 'on_route' end;
    if v_new_status <> v_unit.status then
      update public.parade_units set status = v_new_status where id = p_unit_id;
    end if;
    if v_new_status = 'finished' then
      update public.applications set status = 'completed'
       where id = v_unit.application_id and status in ('assigned', 'checked_in');
    end if;
  elsif v_unit.status <> 'finished' then
    v_conflict := true;
    perform public.log_dispatch_event(v_unit.event_id, p_unit_id, 'conflict', v_unit.status, v_unit.status,
      format('Unit reported at %s while %s', v_cp.name, v_unit.status), null, p_recorded_at, true);
  end if;

  return jsonb_build_object('ok', true, 'movement_event_id', v_id,
                            'status', coalesce(v_new_status, v_unit.status), 'escalated', v_conflict);
end $$;

-- -----------------------------------------------------------------------------
-- Publication layer (§6) and spectator progress (FR-07, FR-08)
-- -----------------------------------------------------------------------------

create function public.publish_public_plan(p_event_id uuid, p_notes text default null)
returns public.publications
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_event public.events;
  v_pub public.publications;
  v_version integer;
begin
  if not public.has_event_role(p_event_id, array['parade_director']::public.app_role[]) then
    raise exception 'Only the Parade Director may publish the public plan' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event_id for update;
  select coalesce(max(version_number), 0) + 1 into v_version from public.publications where event_id = p_event_id;

  insert into public.publications (event_id, version_number, payload)
  values (p_event_id, v_version, jsonb_build_object(
    'event', jsonb_build_object('name', v_event.name, 'year', v_event.year, 'slug', v_event.slug,
                                'starts_at', v_event.starts_at, 'municipality', v_event.municipality),
    'notes', p_notes,
    'route', (select coalesce(jsonb_agg(jsonb_build_object(
                'sequence', r.sequence, 'name', r.name, 'geometry', st_asgeojson(r.geometry)::jsonb)
                order by r.sequence), '[]'::jsonb)
              from public.route_segments r where r.event_id = p_event_id),
    'checkpoints', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', c.code, 'name', c.name, 'sequence', c.sequence,
                'geometry', st_asgeojson(c.location)::jsonb) order by c.sequence), '[]'::jsonb)
              from public.checkpoints c where c.event_id = p_event_id),
    -- Public fields only: no contacts, documents, staging locations or notes.
    'lineup', (select coalesce(jsonb_agg(jsonb_build_object(
                'unit_id', u.id, 'sequence', u.sequence_number, 'name', u.name,
                'category', cat.name, 'description', a.public_description,
                'media_path', a.public_media_path) order by u.sequence_number), '[]'::jsonb)
              from public.parade_units u
              left join public.applications a on a.id = u.application_id
              left join public.parade_categories cat on cat.id = u.category_id
              where u.event_id = p_event_id and u.public_visible and u.sequence_number is not null
                and u.status <> 'withdrawn'
                and (a.id is null or a.status in ('approved', 'assigned', 'checked_in', 'completed')))
  )) returning * into v_pub;
  return v_pub;
end $$;

create function public.latest_publication(p_event_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select p.payload || jsonb_build_object('version', p.version_number, 'published_at', p.published_at)
  from public.publications p join public.events e on e.id = p.event_id
  where e.slug = p_event_slug and e.status <> 'draft'
  order by p.version_number desc limit 1;
$$;

-- Approximate progress for published units only. Derived from marshal
-- checkpoint reports; it is not continuous GPS tracking.
create function public.public_progress(p_event_slug text)
returns table (unit_id uuid, sequence_number integer, phase text,
               last_checkpoint_code text, last_checkpoint_name text, last_reported_at timestamptz)
language sql stable security definer set search_path = public as $$
  with pub as (
    select p.event_id, p.payload from public.publications p join public.events e on e.id = p.event_id
    where e.slug = p_event_slug and e.status in ('live', 'completed')
    order by p.version_number desc limit 1
  ), published_units as (
    select (x ->> 'unit_id')::uuid as unit_id from pub, jsonb_array_elements(pub.payload -> 'lineup') x
  )
  select u.id, u.sequence_number,
         case when u.status = 'finished' then 'finished'
              when u.status in ('released', 'on_route', 'incident') then 'on_route'
              when u.status in ('withdrawn', 'skipped') then 'not_participating'
              else 'staging' end,
         lc.code, lc.name, lc.recorded_at
  from published_units pu
  join public.parade_units u on u.id = pu.unit_id
  left join lateral (
    select c.code, c.name, m.recorded_at from public.movement_events m
    join public.checkpoints c on c.id = m.checkpoint_id
    where m.unit_id = u.id order by c.sequence desc limit 1
  ) lc on true
  order by u.sequence_number;
$$;

-- -----------------------------------------------------------------------------
-- FR-01 / FR-10: duplicate a prior year's configuration.
-- Copies templates only — never assignments, approvals, units or restrictions.
-- -----------------------------------------------------------------------------

create function public.clone_event(p_source_event_id uuid, p_slug text, p_name text, p_year integer)
returns public.events
language plpgsql security definer set search_path = public as $$
declare
  v_new public.events;
  v_src public.events;
  z record;
  l record;
  v_zone uuid;
  v_lane uuid;
begin
  if not public.is_system_admin() then
    raise exception 'Only a system administrator may create events' using errcode = '42501';
  end if;
  select * into v_src from public.events where id = p_source_event_id;
  if not found then raise exception 'Source event not found' using errcode = 'P0002'; end if;

  insert into public.events (slug, name, year, host_organization, municipality, timezone,
                             default_separation_ft, settings, cloned_from_event_id)
  values (p_slug, p_name, p_year, v_src.host_organization, v_src.municipality, v_src.timezone,
          v_src.default_separation_ft, v_src.settings, v_src.id)
  returning * into v_new;

  insert into public.parade_categories (event_id, name, description, sort_order, is_active)
  select v_new.id, name, description, sort_order, is_active from public.parade_categories
  where event_id = v_src.id;

  insert into public.waivers (event_id, title, body, version, is_required, is_active)
  select v_new.id, title, body, version, is_required, is_active from public.waivers
  where event_id = v_src.id and is_active;

  insert into public.route_segments (event_id, sequence, name, geometry)
  select v_new.id, sequence, name, geometry from public.route_segments where event_id = v_src.id;

  insert into public.checkpoints (event_id, code, name, sequence, location, is_merge_point, is_finish)
  select v_new.id, code, name, sequence, location, is_merge_point, is_finish
  from public.checkpoints where event_id = v_src.id;

  for z in select * from public.staging_zones where event_id = v_src.id loop
    insert into public.staging_zones (event_id, code, street_name, description, primary_use, geometry, sort_order)
    values (v_new.id, z.code, z.street_name, z.description, z.primary_use, z.geometry, z.sort_order)
    returning id into v_zone;
    for l in select * from public.staging_lanes where zone_id = z.id loop
      insert into public.staging_lanes (zone_id, lane_number, geometry, width_ft, direction)
      values (v_zone, l.lane_number, l.geometry, l.width_ft, l.direction)
      returning id into v_lane;
      insert into public.staging_blocks (lane_id, block_number, usable_length_ft, permitted_width_ft,
                                         base_status, geometry, accessibility_notes, turning_notes)
      select v_lane, block_number, usable_length_ft, permitted_width_ft, base_status, geometry,
             accessibility_notes, turning_notes
      from public.staging_blocks where lane_id = l.id;
    end loop;
  end loop;

  -- The creating admin directs the new event until roles are delegated.
  insert into public.event_roles (event_id, user_id, role)
  values (v_new.id, auth.uid(), 'parade_director') on conflict do nothing;
  return v_new;
end $$;

-- -----------------------------------------------------------------------------
-- Pass reissue (compromised or lost QR pass)
-- -----------------------------------------------------------------------------

create function public.reissue_unit_pass(p_unit_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_event uuid;
  v_token text;
begin
  select event_id into v_event from public.parade_units where id = p_unit_id;
  if v_event is null or not public.is_event_director(v_event) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  update public.parade_units set pass_token = encode(extensions.gen_random_bytes(16), 'hex')
   where id = p_unit_id returning pass_token into v_token;
  return v_token;
end $$;

-- -----------------------------------------------------------------------------
-- Dashboard summary (one round trip for the director dashboard)
-- -----------------------------------------------------------------------------

create function public.event_dashboard(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_event_staff(p_event_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'applications_by_status', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) n from public.applications where event_id = p_event_id group by status) s),
    'applications_by_category', (
      select coalesce(jsonb_agg(jsonb_build_object('category', coalesce(c.name, 'Uncategorized'), 'count', s.n)
                                order by s.n desc), '[]'::jsonb)
      from (select category_id, count(*) n from public.applications
            where event_id = p_event_id and status not in ('draft', 'withdrawn') group by category_id) s
      left join public.parade_categories c on c.id = s.category_id),
    'units_by_status', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (select status, count(*) n from public.parade_units where event_id = p_event_id group by status) s),
    'participants_total', (
      select coalesce(sum(participant_count), 0) from public.applications
      where event_id = p_event_id and status in ('approved', 'assigned', 'checked_in', 'completed')),
    'active_restrictions', (
      select count(*) from public.restrictions
      where event_id = p_event_id and effective_from <= now() and (effective_to is null or effective_to > now())),
    'flagged_assignments', (
      select count(*) from public.staging_assignments where event_id = p_event_id and status = 'flagged'),
    'open_incidents', (
      select count(*) from public.incidents where event_id = p_event_id and status in ('open', 'acknowledged')),
    'unresolved_dispatch_conflicts', (
      select count(*) from public.dispatch_events
      where event_id = p_event_id and requires_resolution and resolved_at is null)
  );
end $$;

-- Workflow functions require a signed-in user (each also checks event roles);
-- internal helpers are not callable through the API at all.
do $$
declare f text;
begin
  foreach f in array array[
    'public.transition_application(uuid, public.application_status, text)',
    'public.approve_staging_assignment(uuid, text)',
    'public.check_in_unit(text, uuid, timestamptz)',
    'public.set_unit_status(uuid, public.unit_status, text, uuid, timestamptz)',
    'public.authorize_unit(uuid, uuid, timestamptz)',
    'public.release_unit(uuid, uuid, timestamptz)',
    'public.revoke_authorization(uuid, text)',
    'public.set_parade_hold(uuid, boolean, text)',
    'public.record_checkpoint_passage(uuid, uuid, timestamptz, uuid, text)',
    'public.publish_public_plan(uuid, text)',
    'public.clone_event(uuid, text, text, integer)',
    'public.reissue_unit_pass(uuid)',
    'public.event_dashboard(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  foreach f in array array[
    'public.notify_event_directors(uuid, text, text, text, uuid)',
    'public.log_dispatch_event(uuid, uuid, public.dispatch_action, public.unit_status, public.unit_status, text, uuid, timestamptz, boolean)',
    'public.prior_dispatch_result(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
