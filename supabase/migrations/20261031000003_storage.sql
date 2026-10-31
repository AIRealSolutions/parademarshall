-- =============================================================================
-- Storage: private buckets for registration and restriction documents.
-- Object paths: <event_id>/<application_id or restriction_id>/<filename>
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('application-documents', 'application-documents', false),
       ('restriction-documents', 'restriction-documents', false)
on conflict (id) do nothing;

create function public.can_access_application_object(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.applications a
    where a.id::text = (storage.foldername(p_name))[2]
      and a.event_id::text = (storage.foldername(p_name))[1]
      and (a.submitted_by = auth.uid() or public.is_org_member(a.organization_id)
           or public.is_event_staff(a.event_id))
  );
$$;

create policy "application documents read" on storage.objects for select to authenticated
  using (bucket_id = 'application-documents' and public.can_access_application_object(name));
create policy "application documents write" on storage.objects for insert to authenticated
  with check (bucket_id = 'application-documents' and public.can_access_application_object(name));
create policy "application documents delete" on storage.objects for delete to authenticated
  using (bucket_id = 'application-documents' and owner = auth.uid()
         and public.can_access_application_object(name));

create policy "restriction documents read" on storage.objects for select to authenticated
  using (bucket_id = 'restriction-documents'
         and public.is_event_staff(((storage.foldername(name))[1])::uuid));
create policy "restriction documents write" on storage.objects for insert to authenticated
  with check (bucket_id = 'restriction-documents'
              and public.has_event_role(((storage.foldername(name))[1])::uuid,
                    array['parade_director', 'assistant_director', 'public_safety_liaison']::public.app_role[]));
