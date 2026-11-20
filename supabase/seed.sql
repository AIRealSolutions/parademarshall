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
-- Staging layout (2026 plan), west to east along Bay Street:
--
--   S Caswell Ave   S Lord St                  S Atlantic Ave   S Rhett St
--   (facing south)  (2 lanes, south)           (facing south)   (facing south)
--        │            ││                            │                │
--        └──► West Bay St (eastbound) ──► MERGE ◄── East Bay St (westbound) ◄──┘
--                                         Bay St / S Howe St
--                                         parade turns north on Howe St
--
-- West of Howe, Caswell and Lord turn left (east) onto West Bay Street.
-- East of Howe, Atlantic and Rhett turn right (west) onto East Bay Street,
-- where the main lineup extends. Both streams meet at the single merge.
--
-- Geometry follows the approved staging diagram, anchored at the Bay St /
-- S Howe St merge (-78.01985, 33.91620): Bay Street is drawn straight
-- east-west and each side street straight north from its Bay St corner, at
-- the diagram's spacing (about 1 m per diagram unit). Each zone starts at the
-- end nearest the merge. The diagram is schematic, so these lines may not sit
-- exactly on the real curbs: adjust them on the Staging Map and mark them
-- field-validated before approving the plan. Block lengths are sized to fill
-- each line.
--
-- Re-running this file reconciles the layout. A street that already has units
-- placed on it (or ever had) keeps its lanes and blocks and is reported with
-- a NOTICE.
-- =============================================================================
do $$
declare
  v_event uuid := '00000000-0000-4000-8000-000000002026';
  z record;
  v_zone uuid;
  v_lane uuid;
  n integer;
  b integer;
  v_keep text[] := array['SCASWELL', 'SLORD', 'WBAY', 'EBAY', 'SATLANTIC', 'SRHETT'];
begin
  if not exists (select 1 from public.events where id = v_event) then
    return;
  end if;

  -- Streets no longer in the plan are removed if unused.
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
    ('SCASWELL', 'South Caswell Avenue',
     'Westernmost staging street. Vehicles staged facing south; turn left (east) onto West Bay Street.',
     'general'::public.zone_use,
     'LINESTRING(-78.02420 33.91620, -78.02420 33.91838)',
     'southbound'::public.compass_direction, 1, 3, 265::numeric, 10::numeric, 1, 'WBAY',
     'South to Bay St, left onto West Bay, east to Howe St.'),
    ('SLORD', 'South Lord Street',
     'Two lanes of southbound traffic, between Caswell and Howe. Both lanes turn left (east) onto West Bay Street.',
     'general'::public.zone_use,
     'LINESTRING(-78.02202 33.91620, -78.02202 33.91838)',
     'southbound'::public.compass_direction, 2, 3, 265::numeric, 10::numeric, 2, 'WBAY',
     'Two lanes south to Bay St, left onto West Bay, east to Howe St.'),
    ('WBAY', 'West Bay Street',
     'Carries Caswell and Lord traffic east to the merge at South Howe Street.',
     'general'::public.zone_use,
     'LINESTRING(-78.01985 33.91620, -78.02534 33.91620)',
     'eastbound'::public.compass_direction, 2, 5, 330::numeric, 11::numeric, 3, null::text,
     'East on Bay St to the Bay St / S Howe St merge.'),
    ('EBAY', 'East Bay Street',
     'Main lineup. Units face west toward South Howe Street; the front is nearest the merge. Atlantic and Rhett empty onto it.',
     'general'::public.zone_use,
     'LINESTRING(-78.01985 33.91620, -78.01436 33.91620)',
     'westbound'::public.compass_direction, 2, 6, 275::numeric, 11::numeric, 4, null::text,
     'West on Bay St to the Bay St / S Howe St merge.'),
    ('SATLANTIC', 'South Atlantic Avenue',
     'East of Howe. Vehicles staged facing south; turn right (west) onto East Bay Street.',
     'general'::public.zone_use,
     'LINESTRING(-78.01790 33.91620, -78.01790 33.91838)',
     'southbound'::public.compass_direction, 1, 3, 265::numeric, 10::numeric, 5, 'EBAY',
     'South to Bay St, right onto East Bay, west to Howe St.'),
    ('SRHETT', 'South Rhett Street',
     'Easternmost staging street. Vehicles staged facing south; turn right (west) onto East Bay Street.',
     'general'::public.zone_use,
     'LINESTRING(-78.01573 33.91620, -78.01573 33.91838)',
     'southbound'::public.compass_direction, 1, 3, 265::numeric, 10::numeric, 6, 'EBAY',
     'South to Bay St, right onto East Bay, west to Howe St.')
  ) as t(code, street, descr, use, wkt, dir, lanes, blocks, block_len, width, sort, feeds, flow)
  loop
    select id into v_zone from public.staging_zones where event_id = v_event and code = z.code;

    if v_zone is not null and exists (
         select 1 from public.staging_assignments a
         join public.staging_blocks bl on bl.id = a.block_id
         join public.staging_lanes l on l.id = bl.lane_id where l.zone_id = v_zone) then
      -- Units are placed here: record the flow, but don't rebuild lanes or blocks.
      update public.staging_zones set flow_notes = z.flow, sort_order = z.sort where id = v_zone;
      raise notice 'Kept the lanes and blocks on % unchanged: units have been placed there.', z.street;
      continue;
    end if;

    if v_zone is null then
      insert into public.staging_zones (event_id, code, street_name, description, primary_use, geometry, sort_order,
                                        flow_notes)
      values (v_event, z.code, z.street, z.descr, z.use, extensions.st_geomfromtext(z.wkt, 4326), z.sort, z.flow)
      returning id into v_zone;
    else
      update public.staging_zones
         set street_name = z.street, description = z.descr, primary_use = z.use,
             geometry = extensions.st_geomfromtext(z.wkt, 4326), sort_order = z.sort,
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

  -- Link each street to the street it empties onto (null = straight to the merge).
  update public.staging_zones sz
     set feeds_into_zone_id = (select t.id from public.staging_zones t where t.event_id = v_event and t.code = f.feeds)
    from (values ('SCASWELL', 'WBAY'), ('SLORD', 'WBAY'), ('WBAY', null),
                 ('EBAY', null), ('SATLANTIC', 'EBAY'), ('SRHETT', 'EBAY')) as f(code, feeds)
   where sz.event_id = v_event and sz.code = f.code;

  -- Shoreline construction on West Bay: usable boundary pending confirmation (SDS §10).
  insert into public.restrictions (event_id, block_id, status, reason, responsible_authority, is_safety)
  select v_event, bl.id, 'restricted',
         'Shoreline construction area — usable staging boundary not yet confirmed',
         'City of Southport (to be confirmed)', true
  from public.staging_blocks bl
  join public.staging_lanes l on l.id = bl.lane_id
  join public.staging_zones sz on sz.id = l.zone_id
  where sz.event_id = v_event and sz.code = 'WBAY' and bl.block_number = 5
    and not exists (select 1 from public.restrictions r
                    where r.event_id = v_event and r.reason like 'Shoreline construction%');
end $$;
