-- =============================================================================
-- Southport Christmas Parade — initial event configuration (SDS §1)
--
-- IMPORTANT: All geometry, lengths and widths below are PLANNING PLACEHOLDERS.
-- They are approximate and marked field_validated = false. They do not
-- represent approved street closures, lane availability or road capacity, and
-- must be replaced with measured values validated by the responsible
-- authorities before the staging plan is approved.
-- =============================================================================

insert into public.events (id, slug, name, year, host_organization, municipality, status,
                           default_separation_ft, settings)
values (
  '00000000-0000-4000-8000-000000002026', 'southport-christmas-2026',
  'Southport Christmas Parade', 2026, 'To be confirmed', 'Southport, North Carolina',
  'registration_open', 25,
  jsonb_build_object(
    'dates_confirmed', false,
    'fees_enabled', false,
    'approval_policy', 'manual',
    'start', 'Bay Street at South Howe Street',
    'direction', 'Northbound on Howe Street',
    'finish', 'Southport Fire Department'
  )
) on conflict (id) do nothing;

insert into public.parade_categories (event_id, name, sort_order) values
  ('00000000-0000-4000-8000-000000002026', 'Fire & Emergency Apparatus', 10),
  ('00000000-0000-4000-8000-000000002026', 'Marching Band', 20),
  ('00000000-0000-4000-8000-000000002026', 'Float', 30),
  ('00000000-0000-4000-8000-000000002026', 'Community Organization', 40),
  ('00000000-0000-4000-8000-000000002026', 'School & Youth', 50),
  ('00000000-0000-4000-8000-000000002026', 'Faith Community', 60),
  ('00000000-0000-4000-8000-000000002026', 'Business', 70),
  ('00000000-0000-4000-8000-000000002026', 'Civic & Government', 80),
  ('00000000-0000-4000-8000-000000002026', 'Antique & Specialty Vehicles', 90),
  ('00000000-0000-4000-8000-000000002026', 'Equestrian & Animals', 100),
  ('00000000-0000-4000-8000-000000002026', 'Walking Group', 110),
  ('00000000-0000-4000-8000-000000002026', 'Special Guest', 120)
on conflict do nothing;

insert into public.waivers (event_id, title, body, version) values (
  '00000000-0000-4000-8000-000000002026', 'Participant Acknowledgment',
  'PLACEHOLDER — final waiver language must be supplied by the event organizer and reviewed by counsel.' || chr(10) || chr(10) ||
  'I confirm that the information in this application is accurate, that all vehicles are roadworthy, ' ||
  'insured and operated by licensed drivers, that participants will follow marshal and public-safety ' ||
  'instructions, and that no items will be thrown from moving vehicles.',
  1
) on conflict do nothing;

-- Route: Bay/Howe northbound on Howe Street to the Fire Department.
insert into public.route_segments (event_id, sequence, name, geometry) values
  ('00000000-0000-4000-8000-000000002026', 1, 'Howe St: Bay St to Moore St',
   extensions.st_geomfromtext('LINESTRING(-78.01985 33.91620, -78.01995 33.91830)', 4326)),
  ('00000000-0000-4000-8000-000000002026', 2, 'Howe St: Moore St to Nash St',
   extensions.st_geomfromtext('LINESTRING(-78.01995 33.91830, -78.02020 33.92010)', 4326)),
  ('00000000-0000-4000-8000-000000002026', 3, 'Howe St: Nash St to West St',
   extensions.st_geomfromtext('LINESTRING(-78.02020 33.92010, -78.02070 33.92210)', 4326)),
  ('00000000-0000-4000-8000-000000002026', 4, 'Howe St: West St to Fire Department',
   extensions.st_geomfromtext('LINESTRING(-78.02070 33.92210, -78.02250 33.93180)', 4326))
on conflict do nothing;

-- Proposed checkpoints (FR-07). Exact placement must be field-validated.
insert into public.checkpoints (event_id, code, name, sequence, location, is_merge_point, is_finish) values
  ('00000000-0000-4000-8000-000000002026', 'BAY-HOWE', 'Bay St / Howe St (merge)', 1,
   extensions.st_setsrid(extensions.st_makepoint(-78.01985, 33.91620), 4326), true, false),
  ('00000000-0000-4000-8000-000000002026', 'MOORE-HOWE', 'Moore St / Howe St', 2,
   extensions.st_setsrid(extensions.st_makepoint(-78.01995, 33.91830), 4326), false, false),
  ('00000000-0000-4000-8000-000000002026', 'NASH-HOWE', 'Nash St / Howe St', 3,
   extensions.st_setsrid(extensions.st_makepoint(-78.02020, 33.92010), 4326), false, false),
  ('00000000-0000-4000-8000-000000002026', 'WEST-HOWE', 'West St / Howe St', 4,
   extensions.st_setsrid(extensions.st_makepoint(-78.02070, 33.92210), 4326), false, false),
  ('00000000-0000-4000-8000-000000002026', 'FIRE-DEPT', 'Southport Fire Department (finish)', 5,
   extensions.st_setsrid(extensions.st_makepoint(-78.02250, 33.93180), 4326), false, true)
on conflict do nothing;

-- Staging zones, two configurable lanes each, numbered blocks per lane.
do $$
declare
  v_event uuid := '00000000-0000-4000-8000-000000002026';
  z record;
  v_zone uuid;
  v_lane uuid;
  n integer;
  b integer;
begin
  for z in select * from (values
    ('EBAY', 'East Bay Street', 'Primarily fire apparatus. Feeds Howe St at the Bay/Howe merge.',
     'fire_apparatus'::public.zone_use, 'LINESTRING(-78.01985 33.91620, -78.01560 33.91600)',
     'westbound'::public.compass_direction, 3, 300::numeric, 12::numeric, 1),
    ('WBAY', 'West Bay Street', 'General parade units. Shoreline construction may restrict segments.',
     'general'::public.zone_use, 'LINESTRING(-78.01985 33.91620, -78.02420 33.91610)',
     'eastbound'::public.compass_direction, 3, 300::numeric, 11::numeric, 2),
    ('SLORD', 'South Lord Street', 'Overflow staging.',
     'overflow'::public.zone_use, 'LINESTRING(-78.01560 33.91600, -78.01540 33.91820)',
     'southbound'::public.compass_direction, 2, 280::numeric, 10::numeric, 3),
    ('SCASWELL', 'South Caswell Avenue', 'Overflow staging.',
     'overflow'::public.zone_use, 'LINESTRING(-78.02420 33.91610, -78.02430 33.91830)',
     'southbound'::public.compass_direction, 2, 280::numeric, 10::numeric, 4),
    ('SATLANTIC', 'South Atlantic Avenue', 'Overflow staging.',
     'overflow'::public.zone_use, 'LINESTRING(-78.02200 33.91615, -78.02210 33.91830)',
     'southbound'::public.compass_direction, 2, 280::numeric, 10::numeric, 5)
  ) as t(code, street, descr, use, wkt, dir, blocks, block_len, width, sort)
  loop
    insert into public.staging_zones (event_id, code, street_name, description, primary_use, geometry, sort_order)
    values (v_event, z.code, z.street, z.descr, z.use, extensions.st_geomfromtext(z.wkt, 4326), z.sort)
    on conflict (event_id, code) do nothing
    returning id into v_zone;
    continue when v_zone is null;

    for n in 1..2 loop
      insert into public.staging_lanes (zone_id, lane_number, width_ft, direction)
      values (v_zone, n, z.width, z.dir) returning id into v_lane;
      for b in 1..z.blocks loop
        insert into public.staging_blocks (lane_id, block_number, usable_length_ft, permitted_width_ft)
        values (v_lane, b, z.block_len, z.width);
      end loop;
    end loop;
  end loop;
end $$;

-- Shoreline construction: pending confirmation of usable boundaries (SDS §10).
insert into public.restrictions (event_id, block_id, status, reason, responsible_authority, is_safety)
select '00000000-0000-4000-8000-000000002026', b.id, 'restricted',
       'Shoreline construction area — usable staging boundary not yet confirmed',
       'City of Southport (to be confirmed)', true
from public.staging_blocks b
join public.staging_lanes l on l.id = b.lane_id
join public.staging_zones z on z.id = l.zone_id
where z.event_id = '00000000-0000-4000-8000-000000002026' and z.code = 'WBAY' and b.block_number = 3
  and not exists (select 1 from public.restrictions r where r.block_id = b.id);
