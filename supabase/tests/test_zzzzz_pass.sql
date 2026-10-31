-- Parade-day pass page data: public by token, no private details.
\set ON_ERROR_STOP 1

create table test.pass as select id, pass_token from public.parade_units;
grant select on test.pass to anon, authenticated;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
declare p jsonb;
begin
  -- 2027 unit: assigned with approved placement in South Lord St.
  p := public.get_unit_pass((select pass_token from test.pass where id = test.id('u27a')));
  assert p is not null, 'pass not found';
  assert p -> 'unit' ->> 'sequence_number' = '1', p::text;
  assert p -> 'staging' ->> 'street' = 'South Lord Street', p::text;
  assert p -> 'staging' -> 'geometry' ->> 'type' = 'LineString', p::text;
  assert jsonb_array_length(p -> 'checkpoints') = 5;
  assert p::text not like '%910-555%' and p::text not like '%@example.test%', 'private details leaked';
  -- Unknown, malformed and injected tokens return nothing.
  assert public.get_unit_pass('00000000000000000000000000000000') is null;
  assert public.get_unit_pass('not-a-token') is null;
  assert public.get_unit_pass(''' or 1=1 --') is null;
end $$;
reset role;

-- Units ahead: unit u27b (lineup #2) has u27a ahead until u27a is released.
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  assert (public.get_unit_pass((select pass_token from test.pass where id = test.id('u27b'))) -> 'progress' ->> 'units_ahead')::int = 1;
end $$;
reset role;

-- Reissuing a pass invalidates the old link.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select public.reissue_unit_pass(test.id('u27b'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  assert public.get_unit_pass((select pass_token from test.pass where id = test.id('u27b'))) is null, 'old pass still works';
end $$;
reset role;

-- Arrival instructions include the pass link; bad site addresses are refused.
-- (Placement as27b was moved in the operations test, so its instructions are unsent.)
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
select test.expect_error($$select public.queue_assignment_instructions('00000000-0000-4000-8000-000000002026', 'javascript:alert(1)')$$, 'Invalid site');
do $$ begin
  assert public.queue_assignment_instructions(test.id('ev27'), 'https://parademarshall.vercel.app/') = 1;
end $$;
reset role;
do $$ begin
  assert exists (
    select 1 from public.notifications n join public.parade_units u on u.id = test.id('u27b')
    where n.related_id = test.id('as27b')
      and n.body like '%https://parademarshall.vercel.app/pass/' || u.pass_token || '%'), 'pass link missing from email';
end $$;

-- Withdrawn entries have no pass.
update public.applications set status = 'withdrawn' where id = test.id('app27');
update public.parade_units set status = 'withdrawn' where application_id = test.id('app27');
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  assert public.get_unit_pass((select pass_token from test.pass where id = test.id('u27a'))) is null, 'withdrawn pass works';
end $$;
reset role;

\echo 'pass: ok'
