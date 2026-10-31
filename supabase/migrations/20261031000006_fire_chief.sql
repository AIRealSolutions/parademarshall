-- =============================================================================
-- Fire Chief role: full read-only visibility into the event's operations.
--
-- Every staff role can already read operational data (is_event_staff). The
-- Fire Chief additionally sees the leadership-only records: audit history,
-- the notification delivery log, and the profiles behind applications and
-- photo submissions. The role grants no write access; combine it with Public
-- Safety Liaison for hold, incident and emergency-notice authority.
--
-- Role checks below compare role::text so this file can run in a single
-- transaction (a new enum value can't be used before it is committed).
-- =============================================================================

alter type public.app_role add value if not exists 'fire_chief';

-- Leadership that may see everything: director, assistant director, fire chief.
create function public.is_event_overseer(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin() or exists (
    select 1 from public.event_roles r
    where r.event_id = p_event_id and r.user_id = auth.uid()
      and r.role::text in ('parade_director', 'assistant_director', 'fire_chief')
  );
$$;

drop policy audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using (public.is_system_admin() or (event_id is not null and public.is_event_overseer(event_id)));

drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = auth.uid() or (event_id is not null and public.is_event_overseer(event_id)));

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid() or public.is_system_admin()
    or exists (
      select 1 from public.event_roles r
      where public.is_event_staff(r.event_id) and r.user_id = profiles.id
    )
    or exists (
      select 1 from public.applications a
      where a.submitted_by = profiles.id
        and (public.is_event_reviewer(a.event_id) or public.is_event_overseer(a.event_id))
    )
    or exists (
      select 1 from public.photo_submissions p
      where p.submitted_by = profiles.id and public.is_event_overseer(p.event_id)
    )
  );

-- Incidents notify the fire chief along with leadership and the safety liaison.
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
    and r.role::text in ('parade_director', 'assistant_director', 'public_safety_liaison', 'fire_chief')
    and r.user_id is distinct from new.reported_by;
  return null;
end $$;
