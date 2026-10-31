-- =============================================================================
-- Parade Management System — Spectator engagement (SDS FR-08 optional
-- enhancements): sponsor profiles, People's Choice voting and moderated
-- photo submissions. Favorite-unit lists are kept on the viewer's device.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Sponsors
-- -----------------------------------------------------------------------------

create table public.sponsors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  tier text not null default 'community' check (tier in ('presenting', 'gold', 'silver', 'community')),
  website text check (website is null or website ~* '^https?://'),
  description text,
  sort_order integer not null default 0,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sponsors_event_idx on public.sponsors (event_id, sort_order);

create trigger sponsors_touch before update on public.sponsors
  for each row execute function public.touch_updated_at();
create trigger sponsors_audit after insert or update or delete on public.sponsors
  for each row execute function public.audit_row_change();

alter table public.sponsors enable row level security;
create policy sponsors_public_select on public.sponsors for select to anon, authenticated
  using (is_published and exists (select 1 from public.events e where e.id = event_id and e.status <> 'draft'));
create policy sponsors_staff_select on public.sponsors for select to authenticated
  using (public.is_event_staff(event_id));
create policy sponsors_write on public.sponsors for all to authenticated
  using (public.is_event_director(event_id)) with check (public.is_event_director(event_id));

-- -----------------------------------------------------------------------------
-- People's Choice voting: one vote per signed-in person per event, changeable
-- while voting is open. Only units in the published lineup can receive votes.
-- -----------------------------------------------------------------------------

alter table public.events
  add column voting_opens_at timestamptz,
  add column voting_closes_at timestamptz,
  add column voting_results_published boolean not null default false,
  add constraint events_voting_window check (
    voting_closes_at is null or voting_opens_at is null or voting_closes_at > voting_opens_at);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  unit_id uuid not null references public.parade_units (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, voter_id)
);

create index votes_unit_idx on public.votes (unit_id);

alter table public.votes enable row level security;
-- Voters see their own vote; writes go through cast_vote(); tallies through vote_results().
create policy votes_own_select on public.votes for select to authenticated using (voter_id = auth.uid());

create function public.voting_is_open(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select e.voting_opens_at is not null and e.voting_opens_at <= now()
       and (e.voting_closes_at is null or e.voting_closes_at > now())
    from public.events e where e.id = p_event_id
  ), false);
$$;

create function public.cast_vote(p_event_id uuid, p_unit_id uuid) returns public.votes
language plpgsql security definer set search_path = public as $$
declare
  v public.votes;
begin
  if auth.uid() is null then
    raise exception 'Sign in to vote' using errcode = '42501';
  end if;
  if not public.voting_is_open(p_event_id) then
    raise exception 'Voting is not open' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.publications p,
           jsonb_array_elements(p.payload -> 'lineup') x
    where p.event_id = p_event_id
      and p.version_number = (select max(version_number) from public.publications where event_id = p_event_id)
      and (x ->> 'unit_id')::uuid = p_unit_id
  ) then
    raise exception 'That unit is not in the published lineup' using errcode = '22023';
  end if;

  insert into public.votes (event_id, unit_id, voter_id)
  values (p_event_id, p_unit_id, auth.uid())
  on conflict (event_id, voter_id) do update set unit_id = excluded.unit_id, updated_at = now()
  returning * into v;
  return v;
end $$;

-- Tallies: staff always; everyone once the director publishes results.
create function public.vote_results(p_event_id uuid)
returns table (unit_id uuid, unit_name text, sequence_number integer, votes bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_event_staff(p_event_id)
          or coalesce((select voting_results_published from public.events where id = p_event_id), false)) then
    raise exception 'Results are not published' using errcode = '42501';
  end if;
  return query
    select u.id, u.name, u.sequence_number, count(v.id)
    from public.votes v join public.parade_units u on u.id = v.unit_id
    where v.event_id = p_event_id
    group by u.id, u.name, u.sequence_number
    order by count(v.id) desc, u.sequence_number nulls last;
end $$;

-- -----------------------------------------------------------------------------
-- Moderated photo submissions
-- Storage path: <event_id>/<user_id>/<file>. Nothing is public until approved.
-- -----------------------------------------------------------------------------

create table public.photo_submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  unit_id uuid references public.parade_units (id) on delete set null,
  submitted_by uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  storage_path text not null unique,
  caption text check (caption is null or length(caption) <= 300),
  credit_name text check (credit_name is null or length(credit_name) <= 100),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index photo_submissions_event_idx on public.photo_submissions (event_id, status, created_at desc);

create trigger photo_submissions_audit after insert or update or delete on public.photo_submissions
  for each row execute function public.audit_row_change();

alter table public.photo_submissions enable row level security;
create policy photos_public_select on public.photo_submissions for select to anon, authenticated
  using (status = 'approved');
create policy photos_own_select on public.photo_submissions for select to authenticated
  using (submitted_by = auth.uid() or public.is_event_staff(event_id));
create policy photos_insert on public.photo_submissions for insert to authenticated
  with check (
    submitted_by = auth.uid() and status = 'pending'
    and storage_path like event_id::text || '/' || auth.uid()::text || '/%'
    and exists (select 1 from public.events e where e.id = event_id and e.status <> 'draft')
  );
create policy photos_moderate on public.photo_submissions for update to authenticated
  using (public.is_event_director(event_id)) with check (public.is_event_director(event_id));
create policy photos_delete on public.photo_submissions for delete to authenticated
  using ((submitted_by = auth.uid() and status = 'pending') or public.is_event_director(event_id));

-- Limit pending uploads per person, and stamp the moderator.
create function public.photo_submission_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.photo_submissions
        where event_id = new.event_id and submitted_by = new.submitted_by and status = 'pending') >= 10 then
      raise exception 'You have 10 photos waiting for review. Please wait for them to be reviewed.'
        using errcode = '22023';
    end if;
  elsif new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end $$;

create trigger photo_submissions_rules before insert or update on public.photo_submissions
  for each row execute function public.photo_submission_rules();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-photos', 'event-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create function public.can_read_photo_object(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.photo_submissions p
    where p.storage_path = p_name
      and (p.status = 'approved' or p.submitted_by = auth.uid() or public.is_event_staff(p.event_id))
  );
$$;

create policy "event photos read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'event-photos' and public.can_read_photo_object(name));
create policy "event photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-photos' and (storage.foldername(name))[2] = auth.uid()::text);
create policy "event photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'event-photos' and (owner = auth.uid() or exists (
    select 1 from public.photo_submissions p where p.storage_path = name and public.is_event_director(p.event_id))));

-- Grants -------------------------------------------------------------------------
revoke execute on function public.cast_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_vote(uuid, uuid) to authenticated;
