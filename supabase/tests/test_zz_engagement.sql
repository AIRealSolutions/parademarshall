-- Spectator engagement: sponsors, People's Choice voting, moderated photos.
-- Runs last; reuses fixture users and the published 2026 lineup.
\set ON_ERROR_STOP 1

-- Sponsors: hidden until published; directors manage --------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
insert into public.sponsors (event_id, name, tier, website, is_published) values
  ('00000000-0000-4000-8000-000000002026', 'Harbor Bank', 'presenting', 'https://example.test', true),
  ('00000000-0000-4000-8000-000000002026', 'Draft Sponsor', 'community', null, false);
select test.expect_error($$insert into public.sponsors (event_id, name, website)
  values ('00000000-0000-4000-8000-000000002026', 'Bad', 'javascript:alert(1)')$$, 'check constraint');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  assert (select count(*) from public.sponsors) = 1, 'anon should see only published sponsors';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
set role authenticated;
select test.expect_error($$insert into public.sponsors (event_id, name)
  values ('00000000-0000-4000-8000-000000002026', 'Sneaky')$$, 'row-level security');
reset role;

-- Voting -------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
set role authenticated;
select test.expect_error(format($$select public.cast_vote('00000000-0000-4000-8000-000000002026', %L)$$, test.id('unit1')), 'not open');
reset role;
update public.events set voting_opens_at = now() - interval '1 hour', voting_closes_at = now() + interval '1 hour'
 where id = '00000000-0000-4000-8000-000000002026';

select set_config('request.jwt.claim.sub', '', false);
set role anon;
select test.expect_error(format($$select public.cast_vote('00000000-0000-4000-8000-000000002026', %L)$$, test.id('unit1')), 'permission denied');
select test.expect_error($$select * from public.vote_results('00000000-0000-4000-8000-000000002026')$$, 'not published');
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
set role authenticated;
select public.cast_vote('00000000-0000-4000-8000-000000002026', test.id('unit1'));
-- Changing your vote replaces it; it never counts twice.
select public.cast_vote('00000000-0000-4000-8000-000000002026', test.id('unit2'));
-- Units outside the published lineup can't receive votes.
select test.expect_error(format($$select public.cast_vote('00000000-0000-4000-8000-000000002026', %L)$$, test.id('u27a')), 'published lineup');
select test.expect_error($$insert into public.votes (event_id, unit_id, voter_id)
  values ('00000000-0000-4000-8000-000000002026', test.id('unit1'), auth.uid())$$, 'row-level security');
do $$ begin
  assert (select count(*) from public.votes) = 1, 'voter sees only their own single vote';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
set role authenticated;
select public.cast_vote('00000000-0000-4000-8000-000000002026', test.id('unit2'));
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
do $$ begin
  assert (select votes from public.vote_results('00000000-0000-4000-8000-000000002026') where unit_id = test.id('unit2')) = 2;
  assert not exists (select 1 from public.vote_results('00000000-0000-4000-8000-000000002026') where unit_id = test.id('unit1'));
end $$;
reset role;
update public.events set voting_results_published = true where id = '00000000-0000-4000-8000-000000002026';
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  assert (select count(*) from public.vote_results('00000000-0000-4000-8000-000000002026')) = 1;
end $$;
reset role;

-- Photos ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
set role authenticated;
insert into public.photo_submissions (event_id, storage_path, caption)
values ('00000000-0000-4000-8000-000000002026',
        '00000000-0000-4000-8000-000000002026/10000000-0000-4000-8000-000000000005/a.jpg', 'Santa!');
-- Can't file a photo under someone else's folder, or pre-approve it.
select test.expect_error($$insert into public.photo_submissions (event_id, storage_path)
  values ('00000000-0000-4000-8000-000000002026', '00000000-0000-4000-8000-000000002026/10000000-0000-4000-8000-000000000004/b.jpg')$$,
  'row-level security');
select test.expect_error($$insert into public.photo_submissions (event_id, storage_path, status)
  values ('00000000-0000-4000-8000-000000002026', '00000000-0000-4000-8000-000000002026/10000000-0000-4000-8000-000000000005/c.jpg', 'approved')$$,
  'row-level security');
-- Submitters can't approve their own photo.
update public.photo_submissions set status = 'approved' where caption = 'Santa!';
reset role;
insert into storage.objects (bucket_id, name, owner) values
  ('event-photos', '00000000-0000-4000-8000-000000002026/10000000-0000-4000-8000-000000000005/a.jpg',
   '10000000-0000-4000-8000-000000000005');

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  assert (select count(*) from public.photo_submissions) = 0, 'pending photo visible to public';
  assert (select count(*) from storage.objects where bucket_id = 'event-photos') = 0, 'pending file readable by public';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
set role authenticated;
update public.photo_submissions set status = 'approved' where caption = 'Santa!';
do $$ begin
  assert (select reviewed_by from public.photo_submissions where caption = 'Santa!') = '10000000-0000-4000-8000-000000000002';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  assert (select count(*) from public.photo_submissions) = 1;
  assert (select count(*) from storage.objects where bucket_id = 'event-photos') = 1, 'approved file not readable';
end $$;
reset role;

\echo 'engagement: ok'
