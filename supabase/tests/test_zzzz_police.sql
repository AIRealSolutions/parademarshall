-- Police chief (full oversight) and traffic officers (operations, no participant PII).
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000010', 'policechief@example.test'),
  ('10000000-0000-4000-8000-000000000011', 'officer@example.test');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select public.grant_event_role('00000000-0000-4000-8000-000000002026', 'policechief@example.test', 'police_chief');
select public.grant_event_role('00000000-0000-4000-8000-000000002026', 'officer@example.test', 'traffic_officer');
reset role;

-- Police chief sees everything, changes nothing.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000010', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.applications where event_id = '00000000-0000-4000-8000-000000002026') >= 2;
  assert (select count(*) from public.audit_logs where event_id = '00000000-0000-4000-8000-000000002026') > 0;
  assert (select count(*) from public.notifications where event_id = '00000000-0000-4000-8000-000000002026') > 0;
end $$;
select test.expect_error($$select public.set_parade_hold('00000000-0000-4000-8000-000000002026', true, 'x')$$, 'not permitted');
select test.expect_error(format($$select public.authorize_unit(%L)$$, test.id('unit1')), 'dispatch controller');
reset role;

-- Traffic officer: operations yes, participant details no.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000011', false);
set role authenticated;
do $$
declare p record;
begin
  assert (select count(*) from public.parade_units where event_id = '00000000-0000-4000-8000-000000002026') >= 2;
  assert (select count(*) from public.restrictions where event_id = '00000000-0000-4000-8000-000000002026') > 0;
  assert (select count(*) from public.dispatch_events where event_id = '00000000-0000-4000-8000-000000002026') > 0;
  assert (select count(*) from public.movement_events where event_id = '00000000-0000-4000-8000-000000002026') > 0;
  assert jsonb_array_length(public.staging_layout('00000000-0000-4000-8000-000000002026') -> 'zones') = 5;
  assert (select count(*) from public.applications) = 0, 'officer sees applications';
  assert (select count(*) from public.organizations) = 0, 'officer sees organizations';
  assert (select count(*) from public.vehicles) = 0, 'officer sees vehicles';
  assert (select count(*) from public.audit_logs) = 0, 'officer sees audit';
  assert (select count(*) from public.photo_submissions where status <> 'approved') = 0, 'officer sees pending photos';
  -- Route progress: unit1 finished, unit2 still on route, so the route isn't all clear.
  select * into p from public.route_progress('00000000-0000-4000-8000-000000002026') where code = 'MOORE-HOWE';
  assert p.units_passed = 1 and p.units_expected = 2 and not p.all_clear, p::text;
end $$;
-- Officers can report incidents but not dispatch, hold or edit.
insert into public.incidents (event_id, summary, severity, reported_by)
values ('00000000-0000-4000-8000-000000002026', 'Car blocking Nash St', 'moderate', auth.uid());
select test.expect_error(format($$select public.authorize_unit(%L)$$, test.id('unit2')), 'dispatch controller');
select test.expect_error($$select public.set_parade_hold('00000000-0000-4000-8000-000000002026', true, 'x')$$, 'not permitted');
select test.expect_error(format($$select public.record_checkpoint_passage(%L, %L, now())$$, test.id('unit2'), test.id('cp_finish')), 'not permitted');
reset role;

-- Unit 2 passes Moore St: that stretch is now all clear for traffic.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', false);
set role authenticated;
select public.record_checkpoint_passage(test.id('unit2'), test.id('cp_moore'), now());
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000011', false);
set role authenticated;
do $$ begin
  assert (select all_clear from public.route_progress('00000000-0000-4000-8000-000000002026') where code = 'MOORE-HOWE');
  assert not (select all_clear from public.route_progress('00000000-0000-4000-8000-000000002026') where code = 'FIRE-DEPT');
end $$;
reset role;

-- Alerts: the police chief gets every incident; officers only high and critical.
do $$ begin
  assert exists (select 1 from public.notifications n join public.incidents i on i.id = n.related_id
                 where n.recipient_id = '10000000-0000-4000-8000-000000000010' and i.summary = 'Car blocking Nash St');
  assert not exists (select 1 from public.notifications n join public.incidents i on i.id = n.related_id
                     where n.recipient_id = '10000000-0000-4000-8000-000000000011' and i.severity = 'moderate');
end $$;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', false);
set role authenticated;
insert into public.incidents (event_id, summary, severity, reported_by)
values ('00000000-0000-4000-8000-000000002026', 'Crowd surge at Bay St', 'critical', auth.uid());
reset role;
do $$ begin
  assert exists (select 1 from public.notifications where recipient_id = '10000000-0000-4000-8000-000000000011'
                   and channel = 'sms' and subject like '%Crowd surge%');
end $$;

\echo 'police: ok'
