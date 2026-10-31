-- =============================================================================
-- Parade Management System — Phase 2–6 operations
-- Staging layout & geometry editing (FR-03), configuration versions (FR-01),
-- lineup (FR-05), unit splitting (FR-02), staff management, arrival
-- instructions (§8 "Publish"), dispatch conflict resolution, reporting (FR-10)
-- and realtime publication (§7).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Volunteer assignments (SDS §5 "additional tables")
-- -----------------------------------------------------------------------------

create table public.volunteer_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position text not null check (length(trim(position)) > 0),
  checkpoint_id uuid references public.checkpoints (id) on delete set null,
  zone_id uuid references public.staging_zones (id) on delete set null,
  shift_start timestamptz,
  shift_end timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  check (shift_end is null or shift_start is null or shift_end > shift_start)
);

create index volunteer_assignments_event_idx on public.volunteer_assignments (event_id);

alter table public.volunteer_assignments enable row level security;
create policy volunteer_select on public.volunteer_assignments for select to authenticated
  using (user_id = auth.uid() or public.is_event_staff(event_id));
create policy volunteer_write on public.volunteer_assignments for all to authenticated
  using (public.is_event_director(event_id)) with check (public.is_event_director(event_id));

create trigger volunteer_assignments_audit after insert or update or delete on public.volunteer_assignments
  for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- Arrival instructions are tracked per assignment. Moving an assignment clears
-- the marker so revised instructions are sent only after re-approval.
-- -----------------------------------------------------------------------------

alter table public.staging_assignments add column instructions_sent_at timestamptz;

create function public.reset_assignment_instructions() returns trigger
language plpgsql as $$
begin
  if new.block_id is distinct from old.block_id or new.start_offset_ft is distinct from old.start_offset_ft
     or (new.status <> 'approved' and old.status = 'approved') then
    new.instructions_sent_at := null;
  end if;
  return new;
end $$;

create trigger staging_assignments_reset_instructions before update on public.staging_assignments
  for each row execute function public.reset_assignment_instructions();

-- -----------------------------------------------------------------------------
-- Staging layout with display geometry (FR-03)
--
-- Convention: a zone line is drawn starting at the end nearest the dispatch
-- merge, so block 1 is the first block to leave. When a lane or block has no
-- surveyed geometry of its own, a schematic one is derived from the zone line.
-- -----------------------------------------------------------------------------

create function public.lane_display_geometry(p_zone_geom extensions.geometry, p_lane_number integer, p_lane_count integer)
returns extensions.geometry
language plpgsql immutable set search_path = public, extensions as $$
declare
  v_offset double precision := (p_lane_number - (p_lane_count + 1) / 2.0) * 9;
  v_line geometry;
begin
  if p_zone_geom is null then return null; end if;
  if v_offset = 0 then return p_zone_geom; end if;
  v_line := st_offsetcurve(st_transform(p_zone_geom, 3857), v_offset);
  if v_line is null or st_geometrytype(v_line) <> 'ST_LineString' then return p_zone_geom; end if;
  v_line := st_transform(v_line, 4326);
  -- Older GEOS reverses negative offsets; keep the zone's direction.
  if st_distance(st_startpoint(v_line), st_startpoint(p_zone_geom))
     > st_distance(st_endpoint(v_line), st_startpoint(p_zone_geom)) then
    v_line := st_reverse(v_line);
  end if;
  return v_line;
end $$;

create function public.staging_layout(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_event_staff(p_event_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return (
    with lanes as (
      select l.*, z.event_id,
             coalesce(l.geometry, public.lane_display_geometry(
               z.geometry, l.lane_number, count(*) over (partition by l.zone_id)::int)) as display_geom
      from public.staging_lanes l join public.staging_zones z on z.id = l.zone_id
      where z.event_id = p_event_id
    ), blocks as (
      select b.*, la.zone_id,
             sum(b.usable_length_ft) over (partition by b.lane_id order by b.block_number) as cum_end,
             sum(b.usable_length_ft) over (partition by b.lane_id) as lane_total,
             la.display_geom as lane_geom
      from public.staging_blocks b join lanes la on la.id = b.lane_id
    ), block_json as (
      select b.lane_id, b.block_number, jsonb_build_object(
        'id', b.id, 'block_number', b.block_number,
        'usable_length_ft', b.usable_length_ft, 'permitted_width_ft', b.permitted_width_ft,
        'base_status', b.base_status,
        'effective_status', public.block_effective_status(b.id),
        'safety_restricted', public.block_has_safety_restriction(b.id),
        'accessibility_notes', b.accessibility_notes, 'turning_notes', b.turning_notes,
        'restriction_notes', b.restriction_notes,
        'geometry', st_asgeojson(coalesce(b.geometry, case when b.lane_geom is not null then
            st_linesubstring(b.lane_geom,
              least(1, greatest(0, (b.cum_end - b.usable_length_ft) / b.lane_total)),
              least(1, greatest(0, b.cum_end / b.lane_total))) end), 6)::jsonb,
        'assignments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'unit_id', a.unit_id, 'unit_name', u.name, 'sequence_number', u.sequence_number,
            'unit_status', u.status, 'start_offset_ft', a.start_offset_ft,
            'occupied_length_ft', a.occupied_length_ft, 'status', a.status,
            'flag_reason', a.flag_reason, 'override_reason', a.override_reason,
            'instructions_sent_at', a.instructions_sent_at) order by a.start_offset_ft)
          from public.staging_assignments a join public.parade_units u on u.id = a.unit_id
          where a.block_id = b.id and a.status <> 'released'), '[]'::jsonb)
      ) as j
      from blocks b
    ), lane_json as (
      select la.zone_id, la.lane_number, jsonb_build_object(
        'id', la.id, 'lane_number', la.lane_number, 'direction', la.direction, 'width_ft', la.width_ft,
        'geometry', st_asgeojson(la.display_geom, 6)::jsonb,
        'surveyed', la.geometry is not null,
        'blocks', coalesce((select jsonb_agg(bj.j order by bj.block_number)
                            from block_json bj where bj.lane_id = la.id), '[]'::jsonb)
      ) as j
      from lanes la
    )
    select jsonb_build_object(
      'zones', coalesce(jsonb_agg(jsonb_build_object(
        'id', z.id, 'code', z.code, 'street_name', z.street_name, 'description', z.description,
        'primary_use', z.primary_use, 'field_validated', z.field_validated,
        'geometry', st_asgeojson(z.geometry, 6)::jsonb,
        'length_ft', round((st_length(z.geometry::geography) * 3.28084)::numeric, 0),
        'lanes', coalesce((select jsonb_agg(lj.j order by lj.lane_number)
                           from lane_json lj where lj.zone_id = z.id), '[]'::jsonb)
      ) order by z.sort_order), '[]'::jsonb),
      'route', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'sequence', r.sequence, 'name', r.name, 'length_ft', r.length_ft,
          'field_validated', r.field_validated, 'geometry', st_asgeojson(r.geometry, 6)::jsonb)
          order by r.sequence), '[]'::jsonb) from public.route_segments r where r.event_id = p_event_id),
      'checkpoints', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'code', c.code, 'name', c.name, 'sequence', c.sequence,
          'is_merge_point', c.is_merge_point, 'is_finish', c.is_finish, 'field_validated', c.field_validated,
          'geometry', st_asgeojson(c.location, 6)::jsonb) order by c.sequence), '[]'::jsonb)
          from public.checkpoints c where c.event_id = p_event_id),
      'restrictions', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'status', r.status, 'reason', r.reason, 'is_safety', r.is_safety,
          'zone_id', r.zone_id, 'lane_id', r.lane_id, 'block_id', r.block_id,
          'responsible_authority', r.responsible_authority,
          'effective_from', r.effective_from, 'effective_to', r.effective_to,
          'active', r.effective_from <= now() and (r.effective_to is null or r.effective_to > now()))
          order by r.effective_from desc), '[]'::jsonb)
          from public.restrictions r where r.event_id = p_event_id)
    )
    from public.staging_zones z where z.event_id = p_event_id
  );
end $$;

-- -----------------------------------------------------------------------------
-- Configuration versions (FR-01): snapshots, approval, and automatic version
-- records whenever approved geometry changes.
-- -----------------------------------------------------------------------------

create function public.config_snapshot(p_event_id uuid, p_kind public.config_kind) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select case p_kind
    when 'route' then jsonb_build_object(
      'route', (select coalesce(jsonb_agg(jsonb_build_object('sequence', sequence, 'name', name,
                 'geometry', st_asgeojson(geometry)::jsonb) order by sequence), '[]'::jsonb)
                from public.route_segments where event_id = p_event_id),
      'checkpoints', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'sequence', sequence,
                 'geometry', st_asgeojson(location)::jsonb) order by sequence), '[]'::jsonb)
                from public.checkpoints where event_id = p_event_id))
    else jsonb_build_object('zones', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', z.code, 'street_name', z.street_name, 'geometry', st_asgeojson(z.geometry)::jsonb,
        'lanes', (select coalesce(jsonb_agg(jsonb_build_object(
          'lane_number', l.lane_number, 'direction', l.direction, 'width_ft', l.width_ft,
          'geometry', st_asgeojson(l.geometry)::jsonb,
          'blocks', (select coalesce(jsonb_agg(jsonb_build_object(
            'block_number', b.block_number, 'usable_length_ft', b.usable_length_ft,
            'permitted_width_ft', b.permitted_width_ft, 'base_status', b.base_status,
            'geometry', st_asgeojson(b.geometry)::jsonb) order by b.block_number), '[]'::jsonb)
            from public.staging_blocks b where b.lane_id = l.id)) order by l.lane_number), '[]'::jsonb)
          from public.staging_lanes l where l.zone_id = z.id)) order by z.sort_order), '[]'::jsonb)
      from public.staging_zones z where z.event_id = p_event_id))
  end;
$$;

create function public.record_config_version(
  p_event_id uuid, p_kind public.config_kind, p_stage public.config_stage, p_notes text
) returns public.config_versions
language plpgsql security definer set search_path = public as $$
declare
  v public.config_versions;
begin
  perform pg_advisory_xact_lock(hashtext(p_event_id::text || p_kind::text));
  insert into public.config_versions (event_id, kind, stage, version_number, snapshot, notes, created_by)
  values (p_event_id, p_kind, p_stage,
          coalesce((select max(version_number) from public.config_versions
                    where event_id = p_event_id and kind = p_kind), 0) + 1,
          public.config_snapshot(p_event_id, p_kind), p_notes, auth.uid())
  returning * into v;
  return v;
end $$;

create function public.approve_config(p_event_id uuid, p_kind public.config_kind, p_notes text default null)
returns public.config_versions
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_event_role(p_event_id, array['parade_director']::public.app_role[]) then
    raise exception 'Only the Parade Director may approve the operational plan' using errcode = '42501';
  end if;
  return public.record_config_version(p_event_id, p_kind, 'approved', p_notes);
end $$;

-- Edit geometry from the map editor. Accepts GeoJSON (LineString or Point).
create function public.update_geometry(p_kind text, p_id uuid, p_geojson jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_event uuid;
  v_geom geometry;
  v_config public.config_kind;
begin
  v_event := case p_kind
    when 'zone' then (select event_id from public.staging_zones where id = p_id)
    when 'lane' then (select z.event_id from public.staging_lanes l
                      join public.staging_zones z on z.id = l.zone_id where l.id = p_id)
    when 'block' then (select z.event_id from public.staging_blocks b
                       join public.staging_lanes l on l.id = b.lane_id
                       join public.staging_zones z on z.id = l.zone_id where b.id = p_id)
    when 'route_segment' then (select event_id from public.route_segments where id = p_id)
    when 'checkpoint' then (select event_id from public.checkpoints where id = p_id)
  end;
  if v_event is null then
    raise exception 'Unknown % %', p_kind, p_id using errcode = 'P0002';
  end if;
  if not public.is_event_director(v_event) then
    raise exception 'Only the director may edit geometry' using errcode = '42501';
  end if;

  v_geom := case when p_geojson is null then null
                 else st_setsrid(st_geomfromgeojson(p_geojson::text), 4326) end;
  if p_kind = 'checkpoint' and (v_geom is null or st_geometrytype(v_geom) <> 'ST_Point') then
    raise exception 'Checkpoint location must be a point' using errcode = '22023';
  end if;
  if p_kind <> 'checkpoint' and v_geom is not null
     and (st_geometrytype(v_geom) <> 'ST_LineString' or st_npoints(v_geom) < 2) then
    raise exception 'Geometry must be a line with at least two points' using errcode = '22023';
  end if;
  if p_kind in ('zone', 'route_segment') and v_geom is null then
    raise exception 'Geometry is required' using errcode = '22023';
  end if;

  perform set_config('app.audit_context', format('geometry edit: %s', p_kind), true);
  case p_kind
    when 'zone' then update public.staging_zones set geometry = v_geom, field_validated = false where id = p_id;
    when 'lane' then update public.staging_lanes set geometry = v_geom where id = p_id;
    when 'block' then update public.staging_blocks set geometry = v_geom where id = p_id;
    when 'route_segment' then update public.route_segments set geometry = v_geom, field_validated = false where id = p_id;
    when 'checkpoint' then update public.checkpoints set location = v_geom, field_validated = false where id = p_id;
  end case;

  -- Changing approved geometry always leaves a versioned record (FR-01).
  v_config := case when p_kind in ('route_segment', 'checkpoint') then 'route' else 'staging' end;
  if exists (select 1 from public.config_versions
             where event_id = v_event and kind = v_config and stage = 'approved') then
    perform public.record_config_version(v_event, v_config, 'draft',
      format('Changed %s after approval', replace(p_kind, '_', ' ')));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- FR-05: lineup ordering, atomically
-- -----------------------------------------------------------------------------

create function public.set_lineup(p_event_id uuid, p_unit_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not public.is_event_director(p_event_id) then
    raise exception 'Only the Parade Director or delegated assistant may order the procession'
      using errcode = '42501';
  end if;
  if (select count(distinct x) from unnest(p_unit_ids) x) <> coalesce(array_length(p_unit_ids, 1), 0) then
    raise exception 'A unit appears more than once in the lineup' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_unit_ids) x
             left join public.parade_units u on u.id = x and u.event_id = p_event_id
             where u.id is null or u.status = 'withdrawn') then
    raise exception 'Lineup contains a unit that is not active in this event' using errcode = '22023';
  end if;

  perform set_config('app.audit_context', 'lineup reorder', true);
  update public.parade_units set sequence_number = null
   where event_id = p_event_id and sequence_number is not null and not (id = any (p_unit_ids));
  update public.parade_units u set sequence_number = x.ord
    from unnest(p_unit_ids) with ordinality as x(id, ord)
   where u.id = x.id and u.sequence_number is distinct from x.ord;
  select count(*) into v_count from public.parade_units where event_id = p_event_id and sequence_number is not null;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- FR-02: the director may split one entry's vehicles into separate units.
-- -----------------------------------------------------------------------------

create function public.split_unit(p_unit_id uuid, p_new_name text, p_vehicle_ids uuid[])
returns public.parade_units
language plpgsql security definer set search_path = public as $$
declare
  v_unit public.parade_units;
  v_new public.parade_units;
  v_moved numeric;
  v_remaining numeric;
begin
  select * into v_unit from public.parade_units where id = p_unit_id for update;
  if not found then raise exception 'Unit not found' using errcode = 'P0002'; end if;
  if not public.is_event_director(v_unit.event_id) then
    raise exception 'Only the director may split units' using errcode = '42501';
  end if;
  if v_unit.status <> 'not_arrived' then
    raise exception 'Only units that have not arrived can be split' using errcode = '22023';
  end if;
  if coalesce(trim(p_new_name), '') = '' or coalesce(array_length(p_vehicle_ids, 1), 0) = 0 then
    raise exception 'A name and at least one vehicle are required' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_vehicle_ids) x left join public.vehicles v on v.id = x
             where v.id is null or v.unit_id is distinct from p_unit_id) then
    raise exception 'Every vehicle must currently belong to this unit' using errcode = '22023';
  end if;
  if not exists (select 1 from public.vehicles where unit_id = p_unit_id and not (id = any (p_vehicle_ids))) then
    raise exception 'At least one vehicle must stay with the original unit' using errcode = '22023';
  end if;

  select coalesce(sum(length_ft + trailer_length_ft), 0) into v_moved
    from public.vehicles where id = any (p_vehicle_ids);
  select coalesce(sum(length_ft + trailer_length_ft), 0) into v_remaining
    from public.vehicles where unit_id = p_unit_id and not (id = any (p_vehicle_ids));

  insert into public.parade_units (event_id, application_id, name, category_id, footprint_length_ft,
                                   footprint_width_ft, separation_ft, is_emergency_apparatus, group_label)
  values (v_unit.event_id, v_unit.application_id, trim(p_new_name), v_unit.category_id, v_moved,
          v_unit.footprint_width_ft, v_unit.separation_ft, v_unit.is_emergency_apparatus,
          coalesce(v_unit.group_label, v_unit.name))
  returning * into v_new;

  update public.vehicles set unit_id = v_new.id where id = any (p_vehicle_ids);
  update public.parade_units
     set footprint_length_ft = greatest(v_remaining, v_unit.footprint_length_ft - v_moved),
         group_label = coalesce(group_label, name)
   where id = p_unit_id;
  return v_new;
end $$;

-- -----------------------------------------------------------------------------
-- Staff management: grant roles by email (directors cannot browse all profiles).
-- -----------------------------------------------------------------------------

create function public.grant_event_role(p_event_id uuid, p_email text, p_role public.app_role)
returns public.event_roles
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_row public.event_roles;
begin
  if not public.has_event_role(p_event_id, array['parade_director']::public.app_role[]) then
    raise exception 'Only the Parade Director may grant roles' using errcode = '42501';
  end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No account uses that email yet. Ask them to sign in once, then try again.'
      using errcode = 'P0002';
  end if;
  insert into public.event_roles (event_id, user_id, role, granted_by)
  values (p_event_id, v_user, p_role, auth.uid())
  on conflict (event_id, user_id, role) do update set role = excluded.role
  returning * into v_row;
  return v_row;
end $$;

-- -----------------------------------------------------------------------------
-- §8 "Publish": queue arrival instructions for approved placements only.
-- -----------------------------------------------------------------------------

create function public.queue_assignment_instructions(p_event_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
  v_count integer;
begin
  if not public.is_event_director(p_event_id) then
    raise exception 'Only the director may send arrival instructions' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event_id;

  with ready as (
    select a.id as assignment_id, app.id as application_id, app.submitted_by, app.entry_name,
           u.name as unit_name, u.sequence_number, z.street_name, l.lane_number, b.block_number,
           a.start_offset_ft
    from public.staging_assignments a
    join public.parade_units u on u.id = a.unit_id
    join public.applications app on app.id = u.application_id
    join public.staging_blocks b on b.id = a.block_id
    join public.staging_lanes l on l.id = b.lane_id
    join public.staging_zones z on z.id = l.zone_id
    where a.event_id = p_event_id and a.status = 'approved' and a.instructions_sent_at is null
      and app.status in ('assigned', 'checked_in')
  ), queued as (
    insert into public.notifications (event_id, recipient_id, channel, subject, body, related_table, related_id)
    select p_event_id, r.submitted_by, 'email',
           format('%s %s: staging instructions for %s', v_event.year, v_event.name, r.unit_name),
           format(E'Your unit "%s" (entry "%s") is assigned to:\n\n  %s, lane %s, block %s (about %s ft from the block start)\n%s\n%s\n\nShow your parade-day pass to a staging marshal when you arrive.',
                  r.unit_name, r.entry_name, r.street_name, r.lane_number, r.block_number,
                  round(r.start_offset_ft),
                  case when r.sequence_number is not null then format('  Lineup position: %s', r.sequence_number) else '' end,
                  coalesce(v_event.settings ->> 'arrival_instructions', '')),
           'staging_assignments', r.assignment_id
    from ready r
    returning related_id
  )
  update public.staging_assignments a set instructions_sent_at = now()
    from queued q where a.id = q.related_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- FR-06: check-in by unit (marshal verified the unit without a scannable pass)
-- and human resolution of escalated dispatch conflicts.
-- -----------------------------------------------------------------------------

create function public.check_in_unit_by_id(
  p_unit_id uuid, p_client_action_id uuid default null, p_recorded_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  select pass_token into v_token from public.parade_units where id = p_unit_id;
  if v_token is null then raise exception 'Unit not found' using errcode = 'P0002'; end if;
  return public.check_in_unit(v_token, p_client_action_id, p_recorded_at);
end $$;

create function public.resolve_dispatch_conflict(p_dispatch_event_id uuid, p_note text)
returns public.dispatch_events
language plpgsql security definer set search_path = public as $$
declare
  v public.dispatch_events;
begin
  select * into v from public.dispatch_events where id = p_dispatch_event_id for update;
  if not found then raise exception 'Dispatch event not found' using errcode = 'P0002'; end if;
  if not public.has_event_role(v.event_id, array['parade_director', 'dispatch_controller']::public.app_role[]) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Describe how the conflict was resolved' using errcode = '22023';
  end if;
  if not v.requires_resolution or v.resolved_at is not null then
    raise exception 'This event does not need resolution' using errcode = '22023';
  end if;
  update public.dispatch_events set resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note
   where id = p_dispatch_event_id returning * into v;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- FR-10: reporting
-- -----------------------------------------------------------------------------

create function public.event_report(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_event public.events;
begin
  if not public.is_event_staff(p_event_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event_id;

  return jsonb_build_object(
    'registration', (
      select jsonb_build_object(
        'submitted', count(*) filter (where status <> 'draft'),
        'drafts', count(*) filter (where status = 'draft'),
        'approved', count(*) filter (where status in ('approved', 'assigned', 'checked_in', 'completed')),
        'waitlisted', count(*) filter (where status = 'waitlisted'),
        'rejected', count(*) filter (where status = 'rejected'),
        'withdrawn', count(*) filter (where status = 'withdrawn'),
        'no_show', count(*) filter (where status = 'no_show'),
        'participants_approved', coalesce(sum(participant_count) filter (
          where status in ('approved', 'assigned', 'checked_in', 'completed')), 0),
        'organizations', count(distinct organization_id) filter (where status <> 'draft'))
      from public.applications where event_id = p_event_id),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('category', c.name, 'submitted', s.submitted,
                                                   'approved', s.approved) order by c.sort_order), '[]'::jsonb)
      from public.parade_categories c
      join lateral (
        select count(*) filter (where a.status <> 'draft') as submitted,
               count(*) filter (where a.status in ('approved', 'assigned', 'checked_in', 'completed')) as approved
        from public.applications a where a.category_id = c.id
      ) s on true
      where c.event_id = p_event_id and s.submitted > 0),
    'participation', (
      select jsonb_build_object(
        'units_total', count(*) filter (where status <> 'withdrawn'),
        'units_checked_in', count(*) filter (where status not in ('not_arrived', 'withdrawn', 'skipped')),
        'units_finished', count(*) filter (where status = 'finished'),
        'units_skipped', count(*) filter (where status = 'skipped'),
        'units_not_arrived', count(*) filter (where status = 'not_arrived'))
      from public.parade_units where event_id = p_event_id),
    'dispatch', (
      with releases as (
        select recorded_at, recorded_at - lag(recorded_at) over (order by recorded_at) as gap
        from public.dispatch_events where event_id = p_event_id and action = 'release'
      )
      select jsonb_build_object(
        'releases', count(*),
        'first_release', min(recorded_at), 'last_release', max(recorded_at),
        'avg_interval_seconds', round(extract(epoch from avg(gap))::numeric, 0),
        'min_interval_seconds', round(extract(epoch from min(gap))::numeric, 0),
        'max_interval_seconds', round(extract(epoch from max(gap))::numeric, 0),
        'holds', (select count(*) from public.dispatch_events where event_id = p_event_id and action = 'parade_hold'),
        'conflicts', (select count(*) from public.dispatch_events where event_id = p_event_id and action = 'conflict'))
      from releases),
    'staging', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'zone', z.street_name, 'usable_ft', t.usable, 'reserved_ft', t.reserved,
        'blocks', t.blocks, 'blocks_unavailable', t.unavailable) order by z.sort_order), '[]'::jsonb)
      from public.staging_zones z
      join lateral (
        select coalesce(sum(b.usable_length_ft), 0) as usable,
               count(*) as blocks,
               count(*) filter (where public.block_effective_status(b.id) in ('temporarily_closed', 'unavailable')) as unavailable,
               coalesce((select sum(a.occupied_length_ft) from public.staging_assignments a
                         join public.staging_blocks b2 on b2.id = a.block_id
                         join public.staging_lanes l2 on l2.id = b2.lane_id
                         where l2.zone_id = z.id and a.status <> 'released'), 0) as reserved
        from public.staging_blocks b join public.staging_lanes l on l.id = b.lane_id
        where l.zone_id = z.id
      ) t on true
      where z.event_id = p_event_id),
    'incidents', (
      select jsonb_build_object(
        'total', count(*),
        'by_severity', coalesce(jsonb_object_agg(severity, n) filter (where severity is not null), '{}'::jsonb),
        'open', coalesce(sum(open_n), 0))
      from (select severity, count(*) n, count(*) filter (where status in ('open', 'acknowledged')) open_n
            from public.incidents where event_id = p_event_id group by severity) s),
    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'year', e.year, 'slug', e.slug,
        'submitted', (select count(*) from public.applications a where a.event_id = e.id and a.status <> 'draft'),
        'approved', (select count(*) from public.applications a where a.event_id = e.id
                     and a.status in ('approved', 'assigned', 'checked_in', 'completed')),
        'finished', (select count(*) from public.parade_units u where u.event_id = e.id and u.status = 'finished'))
        order by e.year), '[]'::jsonb)
      from public.events e
      where e.name = v_event.name and coalesce(e.municipality, '') = coalesce(v_event.municipality, '')
        and public.is_event_staff(e.id))
  );
end $$;

-- -----------------------------------------------------------------------------
-- Realtime (§7): stream operational changes to staff screens. Realtime
-- applies the same RLS policies, so spectators receive nothing from these.
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.parade_units, public.dispatch_events, public.movement_events, public.events,
      public.incidents, public.announcements, public.staging_assignments;
  end if;
end $$;

-- Grants -------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.staging_layout(uuid)',
    'public.approve_config(uuid, public.config_kind, text)',
    'public.update_geometry(text, uuid, jsonb)',
    'public.set_lineup(uuid, uuid[])',
    'public.split_unit(uuid, text, uuid[])',
    'public.grant_event_role(uuid, text, public.app_role)',
    'public.queue_assignment_instructions(uuid)',
    'public.check_in_unit_by_id(uuid, uuid, timestamptz)',
    'public.resolve_dispatch_conflict(uuid, text)',
    'public.event_report(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  foreach f in array array[
    'public.config_snapshot(uuid, public.config_kind)',
    'public.record_config_version(uuid, public.config_kind, public.config_stage, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
