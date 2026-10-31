-- =============================================================================
-- Parade-day pass for participants.
--
-- get_unit_pass(token) powers the public /pass/<token> page that a participant
-- opens from their QR code, printout or arrival email. The token is the same
-- 128-bit random value encoded in the QR pass, so holding the link is
-- equivalent to holding the printed pass. It returns only what the unit needs
-- on parade day: no contact details, documents or other participants' data.
-- Reissuing a pass (reissue_unit_pass) invalidates the old link.
-- =============================================================================

create function public.get_unit_pass(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_unit public.parade_units;
  v_app public.applications;
  v_event public.events;
  v_staging jsonb;
  v_ahead integer;
  v_last jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return null;
  end if;
  select * into v_unit from public.parade_units where pass_token = p_token;
  if not found or v_unit.status = 'withdrawn' then
    return null;
  end if;
  select * into v_app from public.applications where id = v_unit.application_id;
  if v_app.id is not null and v_app.status not in ('approved', 'assigned', 'checked_in', 'completed') then
    return null;
  end if;
  select * into v_event from public.events where id = v_unit.event_id;

  -- Only an approved placement is shown; proposals may still change.
  select jsonb_build_object(
           'street', z.street_name, 'lane', l.lane_number, 'block', b.block_number,
           'offset_ft', a.start_offset_ft, 'direction', l.direction,
           'geometry', st_asgeojson(coalesce(b.geometry, l.geometry, z.geometry), 6)::jsonb)
    into v_staging
    from public.staging_assignments a
    join public.staging_blocks b on b.id = a.block_id
    join public.staging_lanes l on l.id = b.lane_id
    join public.staging_zones z on z.id = l.zone_id
   where a.unit_id = v_unit.id and a.status = 'approved'
   limit 1;

  -- Units ahead in the lineup that have not yet been released.
  select count(*) into v_ahead
    from public.parade_units u
   where u.event_id = v_unit.event_id and u.sequence_number < v_unit.sequence_number
     and u.status not in ('released', 'on_route', 'finished', 'withdrawn', 'skipped');

  select jsonb_build_object('name', c.name, 'at', m.recorded_at)
    into v_last
    from public.movement_events m join public.checkpoints c on c.id = m.checkpoint_id
   where m.unit_id = v_unit.id
   order by c.sequence desc limit 1;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'name', v_event.name, 'year', v_event.year, 'slug', v_event.slug,
      'starts_at', v_event.starts_at, 'timezone', v_event.timezone, 'status', v_event.status,
      'parade_hold', v_event.parade_hold, 'parade_hold_reason', v_event.parade_hold_reason,
      'arrival_instructions', v_event.settings ->> 'arrival_instructions',
      'start', v_event.settings ->> 'start', 'direction', v_event.settings ->> 'direction',
      'finish', v_event.settings ->> 'finish',
      'merge_point', (select name from public.checkpoints
                      where event_id = v_event.id and is_merge_point order by sequence limit 1)),
    'unit', jsonb_build_object(
      'name', v_unit.name, 'sequence_number', v_unit.sequence_number, 'status', v_unit.status,
      'entry_name', v_app.entry_name,
      'category', (select name from public.parade_categories where id = v_unit.category_id),
      'length_ft', v_unit.footprint_length_ft + v_unit.separation_ft),
    'staging', v_staging,
    'progress', jsonb_build_object(
      'units_ahead', case when v_unit.sequence_number is null then null else v_ahead end,
      'last_checkpoint', v_last),
    'route', (select coalesce(jsonb_agg(jsonb_build_object(
                'name', r.name, 'geometry', st_asgeojson(r.geometry, 6)::jsonb) order by r.sequence), '[]'::jsonb)
              from public.route_segments r where r.event_id = v_event.id),
    'checkpoints', (select coalesce(jsonb_agg(jsonb_build_object(
                'code', c.code, 'name', c.name, 'is_finish', c.is_finish, 'is_merge_point', c.is_merge_point,
                'geometry', st_asgeojson(c.location, 6)::jsonb) order by c.sequence), '[]'::jsonb)
              from public.checkpoints c where c.event_id = v_event.id)
  );
end $$;

grant execute on function public.get_unit_pass(text) to anon, authenticated;

-- Arrival instructions now include the participant's pass link.
drop function public.queue_assignment_instructions(uuid);

create function public.queue_assignment_instructions(p_event_id uuid, p_site_url text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_event public.events;
  v_site text := nullif(rtrim(coalesce(p_site_url, ''), '/'), '');
  v_count integer;
begin
  if not public.is_event_director(p_event_id) then
    raise exception 'Only the director may send arrival instructions' using errcode = '42501';
  end if;
  if v_site is not null and v_site !~ '^https?://[^\s/]+$' then
    raise exception 'Invalid site address' using errcode = '22023';
  end if;
  select * into v_event from public.events where id = p_event_id;

  with ready as (
    select a.id as assignment_id, app.submitted_by, app.entry_name,
           u.name as unit_name, u.sequence_number, u.pass_token, z.street_name, l.lane_number, b.block_number,
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
           format(E'Your unit "%s" (entry "%s") is assigned to:\n\n  %s, lane %s, block %s (about %s ft from the block start)\n%s\n%s\n\n%s',
                  r.unit_name, r.entry_name, r.street_name, r.lane_number, r.block_number,
                  round(r.start_offset_ft),
                  case when r.sequence_number is not null then format('  Lineup position: %s', r.sequence_number) else '' end,
                  coalesce(v_event.settings ->> 'arrival_instructions', ''),
                  case when v_site is not null then
                    format(E'Your parade pass, dashboard sign and live status:\n  %s/pass/%s\n\nShow the pass to a staging marshal when you arrive, on your phone or printed. Anyone with this link can see your pass, so share it only with your unit.',
                           v_site, r.pass_token)
                  else 'Show your parade-day pass (on your entry page) to a staging marshal when you arrive.' end),
           'staging_assignments', r.assignment_id
    from ready r
    returning related_id
  )
  update public.staging_assignments a set instructions_sent_at = now()
    from queued q where a.id = q.related_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.queue_assignment_instructions(uuid, text) from public, anon;
grant execute on function public.queue_assignment_instructions(uuid, text) to authenticated;
