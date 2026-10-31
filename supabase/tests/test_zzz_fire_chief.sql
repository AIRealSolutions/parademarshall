-- Fire Chief: sees everything for the event, changes nothing.
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values ('10000000-0000-4000-8000-000000000009', 'chief@example.test');

-- Directors grant the role by email like any other.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select public.grant_event_role('00000000-0000-4000-8000-000000002026', 'chief@example.test', 'fire_chief');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000009', false);
set role authenticated;
do $$
declare d jsonb;
begin
  -- Operational visibility
  assert (select count(*) from public.applications where event_id = '00000000-0000-4000-8000-000000002026') >= 2;
  assert (select count(*) from public.parade_units where event_id = '00000000-0000-4000-8000-000000002026') >= 2;
  assert (select count(*) from public.dispatch_events where event_id = '00000000-0000-4000-8000-000000002026') > 0;
  assert (select count(*) from public.movement_events where event_id = '00000000-0000-4000-8000-000000002026') > 0;
  assert (select count(*) from public.incidents where event_id = '00000000-0000-4000-8000-000000002026') > 0;
  assert (select count(*) from public.restrictions where event_id = '00000000-0000-4000-8000-000000002026') > 0;
  d := public.event_dashboard('00000000-0000-4000-8000-000000002026');
  assert d ? 'applications_by_status';
  assert jsonb_array_length(public.staging_layout('00000000-0000-4000-8000-000000002026') -> 'zones') = 5;
  -- Leadership-only records
  assert (select count(*) from public.audit_logs where event_id = '00000000-0000-4000-8000-000000002026') > 0, 'audit hidden';
  assert (select count(*) from public.notifications where event_id = '00000000-0000-4000-8000-000000002026') > 0, 'notifications hidden';
  assert exists (select 1 from public.profiles where email = 'participant@example.test'), 'applicant profile hidden';
  assert exists (select 1 from public.profiles where email = 'stranger@example.test'), 'photo submitter profile hidden';
  -- But not another event
  assert (select count(*) from public.applications where event_id <> '00000000-0000-4000-8000-000000002026') = 0;
end $$;

-- Read-only: no approvals, dispatch, holds, edits or role grants.
select test.expect_error(format($$select public.transition_application(%L, 'completed')$$, test.id('app2')), 'not permitted');
select test.expect_error(format($$select public.authorize_unit(%L)$$, test.id('unit1')), 'dispatch controller');
select test.expect_error($$select public.set_parade_hold('00000000-0000-4000-8000-000000002026', true, 'test')$$, 'not permitted');
select test.expect_error($$select public.grant_event_role('00000000-0000-4000-8000-000000002026', 'stranger@example.test', 'fire_chief')$$, 'Only the Parade Director');
select test.expect_error($$select public.publish_public_plan('00000000-0000-4000-8000-000000002026')$$, 'Only the Parade Director');
do $$ begin
  update public.parade_units set name = 'Renamed' where id = test.id('unit2');
  assert (select name from public.parade_units where id = test.id('unit2')) <> 'Renamed', 'fire chief edited a unit';
  update public.events set name = 'Renamed' where id = '00000000-0000-4000-8000-000000002026';
  assert (select name from public.events where id = '00000000-0000-4000-8000-000000002026') <> 'Renamed', 'fire chief edited the event';
end $$;
reset role;

-- New incidents notify the fire chief.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', false);
set role authenticated;
insert into public.incidents (event_id, summary, severity, reported_by)
values ('00000000-0000-4000-8000-000000002026', 'Smoke near Moore St', 'critical', auth.uid());
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where recipient_id = '10000000-0000-4000-8000-000000000009'
                   and related_table = 'incidents' and channel = 'sms');
end $$;

\echo 'fire chief: ok'
