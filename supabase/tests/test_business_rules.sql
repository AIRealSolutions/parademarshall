-- End-to-end business-rule tests: registration → review → staging → check-in →
-- dispatch → checkpoints → publication, exercised through RLS as real roles.
\set ON_ERROR_STOP 1

-- Helpers ---------------------------------------------------------------------
create schema test;
grant usage on schema test to anon, authenticated;

-- Expect a statement to fail; the message must contain p_like.
create function test.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not ilike '%' || p_like || '%' then
      raise exception 'Expected error like "%" but got "%" for: %', p_like, sqlerrm, p_sql;
    end if;
    return;
  end;
  raise exception 'Expected error like "%" but statement succeeded: %', p_like, p_sql;
end $$;
grant execute on function test.expect_error(text, text) to anon, authenticated;

create table test.ids (k text primary key, v uuid);
grant all on test.ids to anon, authenticated;
create function test.id(p text) returns uuid language sql stable as $$ select v from test.ids where k = p $$;
grant execute on function test.id(text) to anon, authenticated;

-- Fixture users ---------------------------------------------------------------
insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'admin@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'director@example.test'),
  ('10000000-0000-4000-8000-000000000003', 'coordinator@example.test'),
  ('10000000-0000-4000-8000-000000000004', 'participant@example.test'),
  ('10000000-0000-4000-8000-000000000005', 'stranger@example.test'),
  ('10000000-0000-4000-8000-000000000006', 'marshal@example.test'),
  ('10000000-0000-4000-8000-000000000007', 'dispatch@example.test'),
  ('10000000-0000-4000-8000-000000000008', 'checkpoint@example.test');
update public.profiles set is_system_admin = true where id = '10000000-0000-4000-8000-000000000001';
insert into public.event_roles (event_id, user_id, role) values
  ('00000000-0000-4000-8000-000000002026', '10000000-0000-4000-8000-000000000002', 'parade_director'),
  ('00000000-0000-4000-8000-000000002026', '10000000-0000-4000-8000-000000000003', 'registration_coordinator'),
  ('00000000-0000-4000-8000-000000002026', '10000000-0000-4000-8000-000000000006', 'staging_marshal'),
  ('00000000-0000-4000-8000-000000002026', '10000000-0000-4000-8000-000000000007', 'dispatch_controller'),
  ('00000000-0000-4000-8000-000000002026', '10000000-0000-4000-8000-000000000008', 'checkpoint_marshal');

-- Participant registers -------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
set role authenticated;

with o as (
  insert into public.organizations (name, contact_name, contact_email)
  values ('Southport Garden Club', 'Pat Lee', 'pat@example.test') returning id
) insert into test.ids select 'org', id from o;

with a as (
  insert into public.applications (event_id, organization_id, entry_name, category_id,
    responsible_contact_name, responsible_contact_phone, responsible_contact_email,
    participant_count, footprint_length_ft, footprint_width_ft, public_description)
  select '00000000-0000-4000-8000-000000002026', test.id('org'), 'Holiday Garden Float',
         (select id from public.parade_categories where name = 'Float'),
         'Pat Lee', '910-555-0100', 'pat@example.test', 12, 30, 9, 'A float covered in poinsettias.'
  returning id
) insert into test.ids select 'app1', id from a;

insert into public.vehicles (application_id, vehicle_type, length_ft, width_ft, is_towing, trailer_length_ft)
values (test.id('app1'), 'Pickup truck', 20, 7, true, 24);

-- Cannot change status directly or submit without the waiver.
select test.expect_error($$update public.applications set status = 'approved' where id = test.id('app1')$$,
                         'transition_application');
select test.expect_error($$select public.transition_application(test.id('app1'), 'submitted')$$, 'waiver');

update public.applications
   set waiver_id = (select id from public.waivers where event_id = '00000000-0000-4000-8000-000000002026'),
       waiver_accepted_at = now(), waiver_accepted_name = 'Pat Lee'
 where id = test.id('app1');
select public.transition_application(test.id('app1'), 'submitted');

-- Participants cannot self-approve.
select test.expect_error($$select public.transition_application(test.id('app1'), 'approved')$$, 'invalid');
do $$ begin
  assert (select status from public.applications where id = test.id('app1')) = 'submitted';
  -- Once submitted, the participant can no longer edit the record.
  update public.applications set entry_name = 'Changed' where id = test.id('app1');
  assert (select entry_name from public.applications where id = test.id('app1')) = 'Holiday Garden Float';
end $$;

-- Second entry (to test one-at-a-time dispatch).
with a as (
  insert into public.applications (event_id, organization_id, entry_name, category_id,
    responsible_contact_name, responsible_contact_phone, responsible_contact_email,
    footprint_length_ft, footprint_width_ft, waiver_id, waiver_accepted_at)
  select '00000000-0000-4000-8000-000000002026', test.id('org'), 'Garden Club Walkers',
         (select id from public.parade_categories where name = 'Walking Group'),
         'Pat Lee', '910-555-0100', 'pat@example.test', 40, 10,
         (select id from public.waivers where event_id = '00000000-0000-4000-8000-000000002026'), now()
  returning id
) insert into test.ids select 'app2', id from a;
select public.transition_application(test.id('app2'), 'submitted');
reset role;

-- Strangers and spectators see nothing private -------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.applications) = 0, 'stranger sees applications';
  assert (select count(*) from public.organizations) = 0, 'stranger sees organizations';
  assert (select count(*) from public.staging_zones) = 0, 'stranger sees staging';
end $$;
select test.expect_error($$select public.transition_application(test.id('app1'), 'under_review')$$, 'not permitted');
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  assert (select count(*) from public.applications) = 0;
  assert (select count(*) from public.parade_units) = 0;
  assert (select count(*) from public.events) = 1, 'anon should see the open event';
end $$;
select test.expect_error($$select public.transition_application(test.id('app1'), 'under_review')$$, 'permission denied');
reset role;

-- Coordinator reviews; only the director approves -----------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
set role authenticated;
select public.transition_application(test.id('app1'), 'under_review');
select public.transition_application(test.id('app2'), 'under_review');
select test.expect_error($$select public.transition_application(test.id('app1'), 'approved')$$, 'not permitted');
select test.expect_error($$select public.transition_application(test.id('app1'), 'needs_information')$$, 'note');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select public.transition_application(test.id('app1'), 'approved');
select public.transition_application(test.id('app2'), 'approved');

insert into test.ids select 'unit1', id from public.parade_units where application_id = test.id('app1');
insert into test.ids select 'unit2', id from public.parade_units where application_id = test.id('app2');
do $$ begin
  -- Footprint = max(declared 30, truck 20 + trailer 24) = 44; separation from event default.
  assert (select footprint_length_ft from public.parade_units where id = test.id('unit1')) = 44;
  assert (select separation_ft from public.parade_units where id = test.id('unit1')) = 25;
  assert (select length(pass_token) from public.parade_units where id = test.id('unit1')) = 32;
end $$;

-- Director cannot bypass dispatch by writing unit status or the parade hold.
select test.expect_error($$update public.events set parade_hold = true where id = '00000000-0000-4000-8000-000000002026'$$,
                         'set_parade_hold');
select test.expect_error($$update public.parade_units set status = 'released' where id = test.id('unit1')$$,
                         'dispatch functions');

-- Lineup order is independent of staging.
update public.parade_units set sequence_number = 1 where id = test.id('unit1');
update public.parade_units set sequence_number = 2 where id = test.id('unit2');

-- Staging rules ---------------------------------------------------------------
insert into test.ids
select 'wbay_l1_b1', b.id from public.staging_blocks b join public.staging_lanes l on l.id = b.lane_id
  join public.staging_zones z on z.id = l.zone_id where z.code = 'WBAY' and l.lane_number = 1 and b.block_number = 1;
insert into test.ids
select 'wbay_l1_b2', b.id from public.staging_blocks b join public.staging_lanes l on l.id = b.lane_id
  join public.staging_zones z on z.id = l.zone_id where z.code = 'WBAY' and l.lane_number = 1 and b.block_number = 2;
insert into test.ids
select 'wbay_l1_b3', b.id from public.staging_blocks b join public.staging_lanes l on l.id = b.lane_id
  join public.staging_zones z on z.id = l.zone_id where z.code = 'WBAY' and l.lane_number = 1 and b.block_number = 3;

-- Seeded shoreline safety restriction cannot be overridden.
select test.expect_error($$insert into public.staging_assignments (event_id, unit_id, block_id, occupied_length_ft, override_reason)
  values ('00000000-0000-4000-8000-000000002026', test.id('unit1'), test.id('wbay_l1_b3'), 69, 'director ok')$$,
  'safety restriction');
-- Complete footprint (44 + 25 separation) is required.
select test.expect_error($$insert into public.staging_assignments (event_id, unit_id, block_id, occupied_length_ft)
  values ('00000000-0000-4000-8000-000000002026', test.id('unit1'), test.id('wbay_l1_b1'), 44)$$, 'separation');
-- Must fit within the block's usable length.
select test.expect_error($$insert into public.staging_assignments (event_id, unit_id, block_id, start_offset_ft, occupied_length_ft)
  values ('00000000-0000-4000-8000-000000002026', test.id('unit1'), test.id('wbay_l1_b1'), 250, 69)$$, 'usable');

with s as (
  insert into public.staging_assignments (event_id, unit_id, block_id, start_offset_ft, occupied_length_ft)
  values ('00000000-0000-4000-8000-000000002026', test.id('unit1'), test.id('wbay_l1_b1'), 0, 69) returning id
) insert into test.ids select 'assign1', id from s;
-- No overlap with reserved space.
select test.expect_error($$insert into public.staging_assignments (event_id, unit_id, block_id, start_offset_ft, occupied_length_ft)
  values ('00000000-0000-4000-8000-000000002026', test.id('unit2'), test.id('wbay_l1_b1'), 50, 65)$$,
  'staging_assignments_no_overlap');
with s as (
  insert into public.staging_assignments (event_id, unit_id, block_id, start_offset_ft, occupied_length_ft)
  values ('00000000-0000-4000-8000-000000002026', test.id('unit2'), test.id('wbay_l1_b1'), 69, 65) returning id
) insert into test.ids select 'assign2', id from s;

select public.approve_staging_assignment(test.id('assign1'));
select public.approve_staging_assignment(test.id('assign2'));
do $$ begin
  assert (select status from public.applications where id = test.id('app1')) = 'assigned';
  assert (select approved_by from public.staging_assignments where id = test.id('assign1'))
         = '10000000-0000-4000-8000-000000000002';
end $$;

-- A new closure flags affected units and notifies — it never relocates them.
insert into public.restrictions (event_id, block_id, status, reason, responsible_authority)
values ('00000000-0000-4000-8000-000000002026', test.id('wbay_l1_b1'), 'temporarily_closed',
        'Utility work', 'Public Works');
do $$ begin
  assert (select count(*) from public.staging_assignments
          where block_id = test.id('wbay_l1_b1') and status = 'flagged') = 2;
  assert (select block_id from public.staging_assignments where id = test.id('assign1')) = test.id('wbay_l1_b1');
  assert exists (select 1 from public.notifications where related_table = 'restrictions'
                   and recipient_id = '10000000-0000-4000-8000-000000000002');
end $$;
-- Re-approving onto the closed block is refused.
select test.expect_error($$select public.approve_staging_assignment(test.id('assign1'), 'please')$$, 'temporarily_closed');
-- Director reassigns to an open block.
update public.staging_assignments set block_id = test.id('wbay_l1_b2'), start_offset_ft = 0, status = 'approved'
 where id = test.id('assign1');
update public.staging_assignments set block_id = test.id('wbay_l1_b2'), start_offset_ft = 69, status = 'approved'
 where id = test.id('assign2');
reset role;

-- Check-in ---------------------------------------------------------------------
insert into test.ids values ('cp_merge', (select id from public.checkpoints where code = 'BAY-HOWE'));
insert into test.ids values ('cp_moore', (select id from public.checkpoints where code = 'MOORE-HOWE'));
insert into test.ids values ('cp_finish', (select id from public.checkpoints where code = 'FIRE-DEPT'));
create table test.tokens as select id, pass_token from public.parade_units;
grant select on test.tokens to authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', false);
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.check_in_unit((select pass_token from test.tokens where id = test.id('unit1')),
                            '20000000-0000-4000-8000-000000000001', now());
  assert (r ->> 'ok')::boolean, r::text;
  assert r -> 'assignment' ->> 'zone' = 'West Bay Street', r::text;
  -- Replaying the same offline action returns the synchronized result.
  r := public.check_in_unit((select pass_token from test.tokens where id = test.id('unit1')),
                            '20000000-0000-4000-8000-000000000001', now());
  assert (r ->> 'duplicate')::boolean, r::text;
  -- A fresh scan of an already checked-in pass is reported, not repeated.
  r := public.check_in_unit((select pass_token from test.tokens where id = test.id('unit1')));
  assert not (r ->> 'ok')::boolean, r::text;
  r := public.check_in_unit('not-a-real-token');
  assert not (r ->> 'ok')::boolean;
  r := public.check_in_unit((select pass_token from test.tokens where id = test.id('unit2')));
  perform public.set_unit_status(test.id('unit1'), 'ready');
  perform public.set_unit_status(test.id('unit2'), 'ready');
end $$;
select test.expect_error($$select public.authorize_unit(test.id('unit1'))$$, 'dispatch controller');
reset role;

-- Dispatch ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', false);
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.authorize_unit(test.id('unit1'));
  assert (r ->> 'ok')::boolean, r::text;
  -- Only one active authorization at the merge.
  r := public.authorize_unit(test.id('unit2'));
  assert not (r ->> 'ok')::boolean and r ->> 'reason' like 'Another unit%', r::text;
  -- Offline conflicting action is escalated for human resolution.
  r := public.authorize_unit(test.id('unit2'), '20000000-0000-4000-8000-000000000002', now() - interval '1 minute');
  assert (r ->> 'escalated')::boolean, r::text;

  -- Parade-wide hold blocks release and new authorizations.
  perform public.set_parade_hold('00000000-0000-4000-8000-000000002026', true, 'Medical call on Howe St');
  r := public.release_unit(test.id('unit1'));
  assert not (r ->> 'ok')::boolean and r ->> 'reason' like 'Parade-wide hold%', r::text;
  perform public.set_parade_hold('00000000-0000-4000-8000-000000002026', false);

  r := public.release_unit(test.id('unit1'));
  assert (r ->> 'ok')::boolean, r::text;
  r := public.authorize_unit(test.id('unit2'));
  assert (r ->> 'ok')::boolean, r::text;
  r := public.release_unit(test.id('unit2'));
  assert (r ->> 'ok')::boolean, r::text;
end $$;
select test.expect_error($$select public.set_parade_hold('00000000-0000-4000-8000-000000002026', true, '')$$, 'reason');
do $$ begin
  assert (select count(*) from public.dispatch_events where requires_resolution) = 1;
  assert (select count(*) from public.dispatch_events where action in ('parade_hold', 'parade_resume')) = 2;
end $$;
reset role;

-- Checkpoints ------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', false);
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.record_checkpoint_passage(test.id('unit1'), test.id('cp_moore'), now(),
                                        '30000000-0000-4000-8000-000000000001');
  assert r ->> 'status' = 'on_route', r::text;
  r := public.record_checkpoint_passage(test.id('unit1'), test.id('cp_moore'), now(),
                                        '30000000-0000-4000-8000-000000000001');
  assert (r ->> 'duplicate')::boolean, r::text;
  r := public.record_checkpoint_passage(test.id('unit1'), test.id('cp_finish'), now());
  assert r ->> 'status' = 'finished', r::text;
  assert (select count(*) from public.movement_events where unit_id = test.id('unit1')) = 2;
  assert (select status from public.applications where id = test.id('app1')) = 'completed';
end $$;
reset role;

-- Publication layer -----------------------------------------------------------
update public.events set status = 'live' where id = '00000000-0000-4000-8000-000000002026';
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select public.publish_public_plan('00000000-0000-4000-8000-000000002026');
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
declare p jsonb;
begin
  p := public.latest_publication('southport-christmas-2026');
  assert jsonb_array_length(p -> 'lineup') = 2, p::text;
  assert jsonb_array_length(p -> 'checkpoints') = 5;
  assert p::text not like '%pat@example.test%', 'private contact leaked to publication';
  assert p::text not like '%910-555%', 'private phone leaked to publication';
  assert p::text not like '%WBAY%', 'staging location leaked to publication';
  assert (select phase from public.public_progress('southport-christmas-2026') where sequence_number = 1) = 'finished';
  assert (select phase from public.public_progress('southport-christmas-2026') where sequence_number = 2) = 'on_route';
end $$;
reset role;

-- Audit trail ------------------------------------------------------------------
do $$ begin
  assert (select count(*) from public.audit_logs where table_name = 'applications' and record_id = test.id('app1')) >= 5;
  assert exists (select 1 from public.audit_logs where table_name = 'dispatch_authorizations'
                   and actor_id = '10000000-0000-4000-8000-000000000007');
end $$;

-- Annual reuse: templates copy, assignments and approvals do not --------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
set role authenticated;
do $$
declare v public.events;
begin
  v := public.clone_event('00000000-0000-4000-8000-000000002026', 'southport-christmas-2027',
                          'Southport Christmas Parade', 2027);
  assert (select count(*) from public.staging_zones where event_id = v.id) = 5;
  assert (select count(*) from public.staging_blocks b join public.staging_lanes l on l.id = b.lane_id
          join public.staging_zones z on z.id = l.zone_id where z.event_id = v.id) = 24;
  assert (select count(*) from public.parade_units where event_id = v.id) = 0;
  assert (select count(*) from public.applications where event_id = v.id) = 0;
  assert (select count(*) from public.restrictions where event_id = v.id) = 0;
  assert (select status from public.events where id = v.id) = 'draft';
end $$;
reset role;

-- Directors cannot grant themselves system administrator.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select test.expect_error($$update public.profiles set is_system_admin = true where id = auth.uid()$$, 'system administrator');
reset role;

\echo 'business rules: ok'
