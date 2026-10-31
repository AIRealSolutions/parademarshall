-- Phase 2–6 operations: roles by email, unit split, lineup, staging layout,
-- geometry versioning, arrival instructions, conflict resolution, reports.
-- Runs after test_business_rules.sql and reuses its fixture users.
\set ON_ERROR_STOP 1

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
set role authenticated;
insert into test.ids select 'ev27', id from public.events where slug = 'southport-christmas-2027';
select public.grant_event_role(test.id('ev27'), 'DIRECTOR@example.test', 'parade_director');
select test.expect_error($$select public.grant_event_role(test.id('ev27'), 'nobody@example.test', 'staging_marshal')$$,
                         'sign in once');
update public.events set status = 'registration_open' where id = test.id('ev27');
reset role;

-- Directors grant roles; coordinators cannot.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select public.grant_event_role(test.id('ev27'), 'marshal@example.test', 'staging_marshal');
select public.grant_event_role(test.id('ev27'), 'dispatch@example.test', 'dispatch_controller');
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
set role authenticated;
select test.expect_error($$select public.grant_event_role(test.id('ev27'), 'stranger@example.test', 'parade_director')$$,
                         'Only the Parade Director');
reset role;

-- Participant registers a two-vehicle entry for 2027 -------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
set role authenticated;
with a as (
  insert into public.applications (event_id, organization_id, entry_name, category_id,
    responsible_contact_name, responsible_contact_phone, responsible_contact_email,
    footprint_length_ft, footprint_width_ft, waiver_id, waiver_accepted_at, waiver_accepted_name)
  select test.id('ev27'), test.id('org'), 'Fire Company Convoy',
         (select id from public.parade_categories where event_id = test.id('ev27') and name like 'Fire%'),
         'Pat Lee', '910-555-0100', 'pat@example.test', 0, 9,
         (select id from public.waivers where event_id = test.id('ev27')), now(), 'Pat Lee'
  returning id
) insert into test.ids select 'app27', id from a;
insert into public.vehicles (application_id, vehicle_type, length_ft) values
  (test.id('app27'), 'Engine', 40), (test.id('app27'), 'Ladder truck', 50);
select public.transition_application(test.id('app27'), 'submitted');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select public.transition_application(test.id('app27'), 'under_review');
select public.transition_application(test.id('app27'), 'approved');
insert into test.ids select 'u27a', id from public.parade_units where application_id = test.id('app27');
do $$ begin
  assert (select footprint_length_ft from public.parade_units where id = test.id('u27a')) = 90;
end $$;

-- Split the ladder truck into its own dispatchable unit.
select test.expect_error(format($$select public.split_unit(%L, 'Ladder 1', array[]::uuid[])$$, test.id('u27a')), 'at least one vehicle');
select test.expect_error(format($$select public.split_unit(%L, 'All', (select array_agg(id) from public.vehicles where application_id = %L))$$,
                                test.id('u27a'), test.id('app27')), 'stay with the original');
insert into test.ids select 'u27b', (public.split_unit(test.id('u27a'), 'Ladder 1',
  (select array_agg(id) from public.vehicles where application_id = test.id('app27') and vehicle_type = 'Ladder truck'))).id;
do $$ begin
  assert (select footprint_length_ft from public.parade_units where id = test.id('u27a')) = 40;
  assert (select footprint_length_ft from public.parade_units where id = test.id('u27b')) = 50;
  assert (select unit_id from public.vehicles where vehicle_type = 'Ladder truck' and application_id = test.id('app27')) = test.id('u27b');
end $$;

-- Lineup ---------------------------------------------------------------------
select test.expect_error(format($$select public.set_lineup(%L, array[%L, %L]::uuid[])$$,
                                test.id('ev27'), test.id('u27a'), test.id('u27a')), 'more than once');
select test.expect_error(format($$select public.set_lineup(%L, array[%L]::uuid[])$$,
                                test.id('ev27'), test.id('unit1')), 'not active in this event');
do $$ begin
  assert public.set_lineup(test.id('ev27'), array[test.id('u27b'), test.id('u27a')]) = 2;
  assert (select sequence_number from public.parade_units where id = test.id('u27b')) = 1;
  -- Reordering swaps positions without tripping the unique constraint.
  assert public.set_lineup(test.id('ev27'), array[test.id('u27a'), test.id('u27b')]) = 2;
  assert (select sequence_number from public.parade_units where id = test.id('u27a')) = 1;
  assert public.set_lineup(test.id('ev27'), array[test.id('u27a')]) = 1;
  assert (select sequence_number from public.parade_units where id = test.id('u27b')) is null;
  perform public.set_lineup(test.id('ev27'), array[test.id('u27a'), test.id('u27b')]);
end $$;

-- Staging layout & geometry ----------------------------------------------------
do $$
declare l jsonb; lane jsonb;
begin
  l := public.staging_layout(test.id('ev27'));
  assert jsonb_array_length(l -> 'zones') = 5, l::text;
  assert jsonb_array_length(l -> 'checkpoints') = 5;
  lane := l -> 'zones' -> 0 -> 'lanes' -> 0;
  assert lane -> 'geometry' ->> 'type' = 'LineString', lane::text;
  assert lane -> 'blocks' -> 0 -> 'geometry' ->> 'type' = 'LineString', lane::text;
  assert lane -> 'blocks' -> 0 ->> 'effective_status' = 'open';
end $$;

insert into test.ids select 'z27', id from public.staging_zones where event_id = test.id('ev27') and code = 'SLORD';
select public.update_geometry('zone', test.id('z27'),
  '{"type":"LineString","coordinates":[[-78.0156,33.9160],[-78.0154,33.9183]]}');
select test.expect_error(format($$select public.update_geometry('checkpoint',
  (select id from public.checkpoints where event_id = %L and code = 'NASH-HOWE'),
  '{"type":"LineString","coordinates":[[-78.02,33.92],[-78.03,33.93]]}')$$, test.id('ev27')), 'must be a point');
select test.expect_error(format($$select public.update_geometry('zone', %L,
  '{"type":"LineString","coordinates":[[-78.02,33.92]]}')$$, test.id('z27')), 'at least two points');
do $$ begin
  assert (select count(*) from public.config_versions where event_id = test.id('ev27')) = 0;
end $$;
select public.approve_config(test.id('ev27'), 'staging', 'Initial plan');
select public.update_geometry('zone', test.id('z27'),
  '{"type":"LineString","coordinates":[[-78.0156,33.9160],[-78.0154,33.9185]]}');
do $$ begin
  assert (select count(*) from public.config_versions where event_id = test.id('ev27') and stage = 'approved') = 1;
  assert (select count(*) from public.config_versions where event_id = test.id('ev27') and stage = 'draft') = 1;
  assert (select max(version_number) from public.config_versions where event_id = test.id('ev27')) = 2;
end $$;
reset role;

-- Only the chief director approves the plan.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', false);
set role authenticated;
select test.expect_error(format($$select public.approve_config(%L, 'staging')$$, test.id('ev27')), 'Only the Parade Director');
select test.expect_error(format($$select public.update_geometry('zone', %L, '{"type":"LineString","coordinates":[[-78,33],[-78.1,33.1]]}')$$,
                                test.id('z27')), 'Only the director');
reset role;

-- Arrival instructions -----------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
insert into test.ids
select 'b27', b.id from public.staging_blocks b join public.staging_lanes l on l.id = b.lane_id
 where l.zone_id = test.id('z27') and l.lane_number = 1 and b.block_number = 1;
with s as (insert into public.staging_assignments (event_id, unit_id, block_id, start_offset_ft, occupied_length_ft)
           values (test.id('ev27'), test.id('u27a'), test.id('b27'), 0, 65) returning id)
insert into test.ids select 'as27a', id from s;
with s as (insert into public.staging_assignments (event_id, unit_id, block_id, start_offset_ft, occupied_length_ft)
           values (test.id('ev27'), test.id('u27b'), test.id('b27'), 65, 75) returning id)
insert into test.ids select 'as27b', id from s;
select public.approve_staging_assignment(test.id('as27a'));
do $$ begin
  -- Not yet assigned: one of the entry's units still lacks an approved placement.
  assert (select status from public.applications where id = test.id('app27')) = 'approved';
  assert public.queue_assignment_instructions(test.id('ev27')) = 0;
end $$;
select public.approve_staging_assignment(test.id('as27b'));
do $$ begin
  assert (select status from public.applications where id = test.id('app27')) = 'assigned';
  assert public.queue_assignment_instructions(test.id('ev27')) = 2;
  assert public.queue_assignment_instructions(test.id('ev27')) = 0;
  assert (select count(*) from public.notifications where related_table = 'staging_assignments'
            and recipient_id = '10000000-0000-4000-8000-000000000004' and body like '%South Lord Street, lane 1, block 1%') = 2;
end $$;
update public.staging_assignments set start_offset_ft = 70 where id = test.id('as27b');
do $$ begin
  assert (select instructions_sent_at from public.staging_assignments where id = test.id('as27b')) is null;
  assert (select instructions_sent_at from public.staging_assignments where id = test.id('as27a')) is not null;
end $$;
reset role;

-- Marshal check-in by unit -----------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', false);
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.check_in_unit_by_id(test.id('u27a'));
  assert (r ->> 'ok')::boolean, r::text;
  assert r -> 'assignment' ->> 'zone' = 'South Lord Street', r::text;
end $$;
reset role;

-- Dispatch conflict resolution ---------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', false);
set role authenticated;
insert into test.ids select 'conflict', id from public.dispatch_events where requires_resolution and resolved_at is null limit 1;
select test.expect_error(format($$select public.resolve_dispatch_conflict(%L, '')$$, test.id('conflict')), 'Describe');
select public.resolve_dispatch_conflict(test.id('conflict'), 'Duplicate offline tap; unit 2 dispatched after unit 1.');
select test.expect_error(format($$select public.resolve_dispatch_conflict(%L, 'again')$$, test.id('conflict')), 'does not need');
reset role;

-- Incidents notify leadership ----------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', false);
set role authenticated;
insert into public.incidents (event_id, summary, severity, reported_by)
values ('00000000-0000-4000-8000-000000002026', 'Horse spooked near Nash St', 'high', auth.uid());
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where related_table = 'incidents' and channel = 'sms'
                   and recipient_id = '10000000-0000-4000-8000-000000000002');
end $$;

-- Announcements: assistant can't issue emergencies; any director can withdraw ----------
reset role;
insert into public.event_roles (event_id, user_id, role)
values ('00000000-0000-4000-8000-000000002026', '10000000-0000-4000-8000-000000000003', 'assistant_director');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
set role authenticated;
select test.expect_error($$insert into public.announcements (event_id, audience, title, body, is_emergency, issued_by)
  values ('00000000-0000-4000-8000-000000002026', 'public', 'Evacuate', 'Now', true, auth.uid())$$, 'row-level security');
insert into public.announcements (event_id, audience, title, body, issued_by, published_at)
values ('00000000-0000-4000-8000-000000002026', 'public', 'Parking', 'Use the Brunswick St lot.', auth.uid(), now());
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
update public.announcements set expires_at = now() where title = 'Parking';
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  assert (select count(*) from public.announcements where title = 'Parking') = 0, 'withdrawn announcement still public';
end $$;
reset role;
delete from public.event_roles where user_id = '10000000-0000-4000-8000-000000000003' and role = 'assistant_director';

-- Reports -------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.event_report('00000000-0000-4000-8000-000000002026');
  assert (r -> 'registration' ->> 'approved')::int = 2, r::text;
  assert (r -> 'participation' ->> 'units_finished')::int = 1, r::text;
  assert (r -> 'dispatch' ->> 'releases')::int = 2, r::text;
  assert (r -> 'dispatch' ->> 'holds')::int = 1, r::text;
  assert jsonb_array_length(r -> 'history') = 2, r::text;
  assert jsonb_array_length(r -> 'staging') = 5, r::text;
end $$;
reset role;

-- Strangers can't read the operational layout or reports.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
set role authenticated;
select test.expect_error(format($$select public.staging_layout(%L)$$, test.id('ev27')), 'Not permitted');
select test.expect_error(format($$select public.event_report(%L)$$, test.id('ev27')), 'Not permitted');
reset role;

\echo 'operations: ok'
