-- =============================================================================
-- Staging traffic flow: each staging street can feed another street, ending at
-- the merge. Example (Southport): South Caswell Ave and South Lord St feed East
-- Bay St, which feeds the Bay St / Howe St merge.
-- A zone with no feeds_into_zone_id leads straight to the merge checkpoint.
-- =============================================================================

alter table public.staging_zones
  add column feeds_into_zone_id uuid references public.staging_zones (id) on delete set null,
  add column flow_notes text,
  add constraint staging_zones_no_self_feed check (feeds_into_zone_id is distinct from id);

create index staging_zones_feeds_into_idx on public.staging_zones (feeds_into_zone_id);

-- A zone may only feed a zone of the same event, and the chain must not loop.
create function public.check_staging_flow() returns trigger
language plpgsql set search_path = public as $$
declare
  v_cursor uuid := new.feeds_into_zone_id;
  v_steps integer := 0;
begin
  if new.feeds_into_zone_id is null then
    return new;
  end if;
  if not exists (select 1 from public.staging_zones
                 where id = new.feeds_into_zone_id and event_id = new.event_id) then
    raise exception 'A staging street can only feed a street in the same event';
  end if;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'Staging flow would loop back to %', new.street_name;
    end if;
    v_steps := v_steps + 1;
    exit when v_steps > 100;
    select feeds_into_zone_id into v_cursor from public.staging_zones where id = v_cursor;
  end loop;
  return new;
end $$;

create trigger staging_zones_flow before insert or update of feeds_into_zone_id on public.staging_zones
  for each row execute function public.check_staging_flow();

-- staging_layout(): unchanged except that each zone now reports its flow.
create or replace function public.staging_layout(p_event_id uuid) returns jsonb
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
        'feeds_into_zone_id', z.feeds_into_zone_id,
        'feeds_into', (select f.street_name from public.staging_zones f where f.id = z.feeds_into_zone_id),
        'flow_notes', z.flow_notes,
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

-- clone_event(): next year's event keeps the staging flow.
create or replace function public.clone_event(p_source_event_id uuid, p_slug text, p_name text, p_year integer)
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
    insert into public.staging_zones (event_id, code, street_name, description, primary_use, geometry, sort_order,
                                      flow_notes)
    values (v_new.id, z.code, z.street_name, z.description, z.primary_use, z.geometry, z.sort_order,
            z.flow_notes)
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

  -- Re-link the flow by zone code once every zone exists.
  update public.staging_zones nz
     set feeds_into_zone_id = nt.id
    from public.staging_zones sz
    join public.staging_zones st on st.id = sz.feeds_into_zone_id
    join public.staging_zones nt on nt.event_id = v_new.id and nt.code = st.code
   where sz.event_id = v_src.id and nz.event_id = v_new.id and nz.code = sz.code;

  -- The creating admin directs the new event until roles are delegated.
  insert into public.event_roles (event_id, user_id, role)
  values (v_new.id, auth.uid(), 'parade_director') on conflict do nothing;
  return v_new;
end $$;
