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

-- =============================================================================
-- Staging layout (2026 plan)
--
--   S Caswell Ave (facing south) ─┐
--   S Lord St (2 lanes, south)  ──┤
--   S Atlantic Ave (facing south)─┼─► East Bay St (westbound) ─► MERGE at Bay St / S Howe St
--   S Rhett St (facing south)   ──┘                                 └─► parade north on Howe St
--
-- Every side street drains south onto East Bay Street, and East Bay Street
-- carries the lineup west to the single merge at South Howe Street.
--
-- Zone geometry is drawn starting at the end nearest the merge: East Bay from
-- Howe St eastward, each side street from its Bay St corner northward.
-- Coordinates and the east-west order of the side streets are PLACEHOLDERS;
-- redraw them on the Staging Map before approving the plan.
--
-- Re-running this file reconciles the layout. A street that already has units
-- placed on it (or ever had) is left untouched and reported with a NOTICE.
-- =============================================================================
do $$
declare
  v_event uuid := '00000000-0000-4000-8000-000000002026';
  z record;
  v_zone uuid;
  v_lane uuid;
  n integer;
  b integer;
  v_keep text[] := array['EBAY', 'SLORD', 'SCASWELL', 'SATLANTIC', 'SRHETT'];
begin
  if not exists (select 1 from public.events where id = v_event) then
    return;
  end if;

  -- Streets no longer in the plan (e.g. West Bay Street) are removed if unused.
  for z in select sz.id, sz.street_name from public.staging_zones sz
           where sz.event_id = v_event and sz.code <> all (v_keep) loop
    if exists (select 1 from public.staging_assignments a
               join public.staging_blocks bl on bl.id = a.block_id
               join public.staging_lanes l on l.id = bl.lane_id where l.zone_id = z.id) then
      raise notice 'Kept % in the staging plan: units have been placed there.', z.street_name;
    else
      delete from public.staging_zones where id = z.id;
    end if;
  end loop;

  for z in select * from (values
    ('EBAY', 'East Bay Street',
     'Main lineup. Units face west toward South Howe Street; the front of the parade is nearest the merge. Every side street empties onto East Bay.',
     'general'::public.zone_use,
     'LINESTRING(-78.01985 33.91620, -78.01250 33.91590)',
     'westbound'::public.compass_direction, 2, 6, 300::numeric, 11::numeric, 1, null::text,
     'Leads directly to the Bay St / S Howe St merge.'),
    ('SLORD', 'South Lord Street',
     'Two lanes of southbound traffic. Both lanes turn right (west) onto East Bay Street.',
     'general'::public.zone_use,
     'LINESTRING(-78.01700 33.91610, -78.01690 33.91830)',
     'southbound'::public.compass_direction, 2, 3, 260::numeric, 10::numeric, 2, 'EBAY',
     'Two lanes south to Bay St, then right onto East Bay toward Howe St.'),
    ('SCASWELL', 'South Caswell Avenue',
     'Vehicles staged facing south. Drains onto East Bay Street.',
     'general'::public.zone_use,
     'LINESTRING(-78.01280 33.91592, -78.01270 33.91830)',
     'southbound'::public.compass_direction, 1, 3, 280::numeric, 10::numeric, 3, 'EBAY',
     'South to Bay St, then right onto East Bay toward Howe St.'),
    ('SATLANTIC', 'South Atlantic Avenue',
     'Vehicles staged facing south. Drains onto East Bay Street.',
     'general'::public.zone_use,
     'LINESTRING(-78.01550 33.91605, -78.01540 33.91830)',
     'southbound'::public.compass_direction, 1, 3, 260::numeric, 10::numeric, 4, 'EBAY',
     'South to Bay St, then right onto East Bay toward Howe St.'),
    ('SRHETT', 'South Rhett Street',
     'Vehicles staged facing south. Drains onto East Bay Street.',
     'general'::public.zone_use,
     'LINESTRING(-78.01410 33.91600, -78.01400 33.91830)',
     'southbound'::public.compass_direction, 1, 3, 260::numeric, 10::numeric, 5, 'EBAY',
     'South to Bay St, then right onto East Bay toward Howe St.')
  ) as t(code, street, descr, use, wkt, dir, lanes, blocks, block_len, width, sort, feeds, flow)
  loop
    select id into v_zone from public.staging_zones where event_id = v_event and code = z.code;

    if v_zone is not null and exists (
         select 1 from public.staging_assignments a
         join public.staging_blocks bl on bl.id = a.block_id
         join public.staging_lanes l on l.id = bl.lane_id where l.zone_id = v_zone) then
      -- Units are placed here: record the flow, but don't rebuild lanes or blocks.
      update public.staging_zones
         set feeds_into_zone_id = (select id from public.staging_zones where event_id = v_event and code = z.feeds),
             flow_notes = z.flow, sort_order = z.sort
       where id = v_zone;
      raise notice 'Kept the lanes and blocks on % unchanged: units have been placed there.', z.street;
      continue;
    end if;

    if v_zone is null then
      insert into public.staging_zones (event_id, code, street_name, description, primary_use, geometry, sort_order,
                                        feeds_into_zone_id, flow_notes)
      values (v_event, z.code, z.street, z.descr, z.use, extensions.st_geomfromtext(z.wkt, 4326), z.sort,
              (select id from public.staging_zones where event_id = v_event and code = z.feeds), z.flow)
      returning id into v_zone;
    else
      update public.staging_zones
         set street_name = z.street, description = z.descr, primary_use = z.use,
             geometry = extensions.st_geomfromtext(z.wkt, 4326), sort_order = z.sort,
             feeds_into_zone_id = (select id from public.staging_zones where event_id = v_event and code = z.feeds),
             flow_notes = z.flow, field_validated = false
       where id = v_zone;
      delete from public.staging_lanes where zone_id = v_zone;
    end if;

    for n in 1..z.lanes loop
      insert into public.staging_lanes (zone_id, lane_number, width_ft, direction)
      values (v_zone, n, z.width, z.dir) returning id into v_lane;
      for b in 1..z.blocks loop
        insert into public.staging_blocks (lane_id, block_number, usable_length_ft, permitted_width_ft)
        values (v_lane, b, z.block_len, z.width);
      end loop;
    end loop;
  end loop;

end $$;
