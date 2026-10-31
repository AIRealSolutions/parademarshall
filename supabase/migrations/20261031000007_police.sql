-- =============================================================================
-- Police roles.
--
--  police_chief     Same oversight as the fire chief: reads everything for the
--                   event (including audit and delivery logs), changes nothing.
--  traffic_officer  Officers controlling traffic. They see operations (units,
--                   staging, route, restrictions, dispatch, checkpoint progress,
--                   incidents) and may report incidents, but not participants'
--                   private details (applications, contacts, vehicles, documents).
--
-- Role checks compare role::text so the file runs in a single transaction.
-- =============================================================================

alter type public.app_role add value if not exists 'police_chief';
alter type public.app_role add value if not exists 'traffic_officer';

create or replace function public.is_event_overseer(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin() or exists (
    select 1 from public.event_roles r
    where r.event_id = p_event_id and r.user_id = auth.uid()
      and r.role::text in ('parade_director', 'assistant_director', 'fire_chief', 'police_chief')
  );
$$;

-- Staff who may see participant details: any staff role other than traffic officer.
create function public.can_view_participant_details(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin() or exists (
    select 1 from public.event_roles r
    where r.event_id = p_event_id and r.user_id = auth.uid() and r.role::text <> 'traffic_officer'
  );
$$;

drop policy applications_select on public.applications;
create policy applications_select on public.applications for select to authenticated
  using (
    submitted_by = auth.uid() or public.is_org_member(organization_id)
    or public.can_view_participant_details(event_id)
  );

drop policy organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated
  using (
    created_by = auth.uid() or public.is_org_member(id) or public.is_system_admin()
    or exists (
      select 1 from public.applications a
      where a.organization_id = organizations.id and public.can_view_participant_details(a.event_id)
    )
  );

drop policy vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles for select to authenticated
  using (exists (
    select 1 from public.applications a where a.id = application_id
      and (a.submitted_by = auth.uid() or public.is_org_member(a.organization_id)
           or public.can_view_participant_details(a.event_id))
  ));

create or replace function public.can_access_application_object(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.applications a
    where a.id::text = (storage.foldername(p_name))[2]
      and a.event_id::text = (storage.foldername(p_name))[1]
      and (a.submitted_by = auth.uid() or public.is_org_member(a.organization_id)
           or public.can_view_participant_details(a.event_id))
  );
$$;

-- Pending (unmoderated) photos are for moderators and their submitters only.
drop policy photos_own_select on public.photo_submissions;
create policy photos_own_select on public.photo_submissions for select to authenticated
  using (submitted_by = auth.uid() or public.can_view_participant_details(event_id));

-- Incident alerts: leadership, safety and both chiefs for every incident;
-- traffic officers for high and critical incidents.
create or replace function public.notify_incident() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (event_id, recipient_id, channel, subject, body, related_table, related_id)
  select distinct new.event_id, r.user_id,
         case when new.severity in ('high', 'critical') then 'sms'::public.notification_channel
              else 'in_app'::public.notification_channel end,
         format('Incident (%s): %s', new.severity, new.summary),
         coalesce(new.details, new.summary), 'incidents', new.id
  from public.event_roles r
  where r.event_id = new.event_id
    and r.user_id is distinct from new.reported_by
    and (r.role::text in ('parade_director', 'assistant_director', 'public_safety_liaison', 'fire_chief', 'police_chief')
         or (r.role::text = 'traffic_officer' and new.severity in ('high', 'critical')));
  return null;
end $$;

-- Parade progress for traffic control: where the head and tail of the parade
-- are, so officers know when each stretch of the route is clear. Advisory only;
-- reopening streets is a police decision.
create function public.route_progress(p_event_id uuid)
returns table (checkpoint_id uuid, code text, name text, sequence integer,
               units_passed bigint, units_expected bigint, head_passed_at timestamptz,
               tail_passed_at timestamptz, all_clear boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_event_staff(p_event_id) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
    with participating as (
      -- Units still in the parade: in the lineup, not withdrawn or skipped.
      select u.id from public.parade_units u
      where u.event_id = p_event_id and u.sequence_number is not null
        and u.status not in ('withdrawn', 'skipped')
    )
    select c.id, c.code, c.name, c.sequence,
           count(m.id),
           (select count(*) from participating),
           min(m.recorded_at),
           case when count(m.id) = (select count(*) from participating) then max(m.recorded_at) end,
           count(m.id) = (select count(*) from participating) and (select count(*) from participating) > 0
    from public.checkpoints c
    left join public.movement_events m on m.checkpoint_id = c.id and m.unit_id in (select id from participating)
    where c.event_id = p_event_id
    group by c.id, c.code, c.name, c.sequence
    order by c.sequence;
end $$;

revoke execute on function public.route_progress(uuid) from public, anon;
grant execute on function public.route_progress(uuid) to authenticated;
