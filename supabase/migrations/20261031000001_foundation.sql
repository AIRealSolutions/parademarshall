-- =============================================================================
-- Parade Management System — Foundation schema
-- Events, people, roles, registration, units, staging geometry, route,
-- operations tables, audit logging and Row Level Security.
--
-- Spec references: SDS v1.0 §2 (roles), §3 (FR-01..FR-10), §5 (database), §6 (rules)
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------

create type public.event_status as enum (
  'draft', 'registration_open', 'registration_closed', 'operational', 'live', 'completed', 'archived'
);

-- Spectators are anonymous and have no row; System Administrator is a profile flag.
create type public.app_role as enum (
  'parade_director',
  'assistant_director',
  'registration_coordinator',
  'staging_marshal',
  'dispatch_controller',
  'checkpoint_marshal',
  'public_safety_liaison'
);

create type public.application_status as enum (
  'draft', 'submitted', 'under_review', 'needs_information', 'approved', 'waitlisted',
  'assigned', 'checked_in', 'completed', 'withdrawn', 'rejected', 'no_show'
);

create type public.unit_status as enum (
  'not_arrived', 'checked_in', 'staged', 'ready', 'authorized', 'released', 'on_route', 'finished',
  'held', 'skipped', 'withdrawn', 'incident'
);

create type public.segment_status as enum ('open', 'restricted', 'temporarily_closed', 'unavailable');

create type public.compass_direction as enum ('northbound', 'southbound', 'eastbound', 'westbound');

create type public.zone_use as enum ('fire_apparatus', 'general', 'overflow');

create type public.config_kind as enum ('route', 'staging');

create type public.config_stage as enum ('draft', 'approved', 'published');

create type public.assignment_status as enum ('proposed', 'approved', 'flagged', 'released');

create type public.dispatch_action as enum (
  'check_in', 'status_change', 'authorize', 'release', 'revoke', 'hold_unit', 'skip',
  'parade_hold', 'parade_resume', 'conflict'
);

create type public.movement_source as enum ('marshal', 'dispatch', 'gps', 'manual');

create type public.incident_severity as enum ('low', 'moderate', 'high', 'critical');

create type public.incident_status as enum ('open', 'acknowledged', 'resolved', 'closed');

create type public.announcement_audience as enum ('public', 'participants', 'staff');

create type public.notification_channel as enum ('email', 'sms', 'in_app');

create type public.notification_status as enum ('pending', 'sent', 'failed', 'cancelled');

-- -----------------------------------------------------------------------------
-- Shared trigger: updated_at
-- -----------------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- People
-- -----------------------------------------------------------------------------

-- "users" in the SDS: an authentication-linked profile.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone text,
  is_system_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Events
-- -----------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  year integer not null check (year between 2000 and 2200),
  host_organization text,
  municipality text,
  timezone text not null default 'America/New_York',
  status public.event_status not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  -- Default separation allowance added to every unit footprint (feet).
  default_separation_ft numeric(6, 1) not null default 25 check (default_separation_ft >= 0),
  settings jsonb not null default '{}'::jsonb,
  -- Parade-wide hold (FR-06). While true, no new dispatch authorizations.
  parade_hold boolean not null default false,
  parade_hold_reason text,
  parade_hold_by uuid references public.profiles (id),
  parade_hold_at timestamptz,
  cloned_from_event_id uuid references public.events (id),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at),
  check (registration_closes_at is null or registration_opens_at is null
         or registration_closes_at >= registration_opens_at)
);

create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

create table public.event_roles (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (event_id, user_id, role)
);

create index event_roles_user_idx on public.event_roles (user_id);

-- -----------------------------------------------------------------------------
-- Permission helpers (SECURITY DEFINER so RLS policies can call them without
-- recursing through event_roles' own policies).
-- -----------------------------------------------------------------------------

create function public.is_system_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_system_admin from public.profiles where id = auth.uid()), false);
$$;

create function public.has_event_role(p_event_id uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin() or exists (
    select 1 from public.event_roles r
    where r.event_id = p_event_id and r.user_id = auth.uid() and r.role = any (p_roles)
  );
$$;

-- Any operational staff role for the event.
create function public.is_event_staff(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_system_admin() or exists (
    select 1 from public.event_roles r where r.event_id = p_event_id and r.user_id = auth.uid()
  );
$$;

-- Director or explicitly delegated assistant director.
create function public.is_event_director(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_event_role(p_event_id, array['parade_director', 'assistant_director']::public.app_role[]);
$$;

-- Users who review registrations.
create function public.is_event_reviewer(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_event_role(
    p_event_id, array['parade_director', 'assistant_director', 'registration_coordinator']::public.app_role[]
  );
$$;

-- Only system admins may toggle is_system_admin.
create function public.guard_profile_admin_flag() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_system_admin is distinct from old.is_system_admin
     and auth.uid() is not null and not public.is_system_admin() then
    raise exception 'Only a system administrator can change administrator status'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard_admin before update on public.profiles
  for each row execute function public.guard_profile_admin_flag();

-- -----------------------------------------------------------------------------
-- Organizations (persist across years for annual reuse, FR-10)
-- -----------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  contact_name text,
  contact_email text,
  contact_phone text,
  mailing_address text,
  website text,
  description text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create function public.add_org_creator_as_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.organization_members (organization_id, user_id, is_owner)
    values (new.id, new.created_by, true) on conflict do nothing;
  end if;
  return new;
end $$;

create trigger organizations_owner after insert on public.organizations
  for each row execute function public.add_org_creator_as_owner();

create function public.is_org_member(p_org_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org_id and m.user_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- Event configuration: categories and waivers (FR-01)
-- -----------------------------------------------------------------------------

create table public.parade_categories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

create table public.waivers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null,
  body text not null,
  version integer not null default 1,
  is_required boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, title, version)
);

-- -----------------------------------------------------------------------------
-- Registration (FR-02)
-- -----------------------------------------------------------------------------

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  organization_id uuid not null references public.organizations (id),
  submitted_by uuid not null references public.profiles (id) default auth.uid(),
  entry_name text not null check (length(trim(entry_name)) > 0),
  purpose text,
  category_id uuid references public.parade_categories (id),
  responsible_contact_name text not null,
  responsible_contact_phone text not null,
  responsible_contact_email text not null,
  participant_count integer not null default 0 check (participant_count >= 0),
  -- Full unit footprint as declared by the participant (feet).
  footprint_length_ft numeric(7, 1) not null default 0 check (footprint_length_ft >= 0),
  footprint_width_ft numeric(6, 1) not null default 0 check (footprint_width_ft >= 0),
  has_animals boolean not null default false,
  has_amplified_sound boolean not null default false,
  safety_requirements text,
  accessibility_needs text,
  -- Public-facing profile (only exposed via the publication layer).
  public_name text,
  public_description text,
  public_media_path text,
  status public.application_status not null default 'draft',
  status_note text,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  waiver_id uuid references public.waivers (id),
  waiver_accepted_at timestamptz,
  waiver_accepted_name text,
  -- Payment is modular and disabled unless fees are adopted (FR-02).
  payment_status text not null default 'not_required'
    check (payment_status in ('not_required', 'pending', 'paid', 'refunded', 'waived')),
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index applications_event_status_idx on public.applications (event_id, status);
create index applications_org_idx on public.applications (organization_id);
create index applications_submitter_idx on public.applications (submitted_by);

create trigger applications_touch before update on public.applications
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Parade units and vehicles
-- -----------------------------------------------------------------------------

create table public.parade_units (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  application_id uuid references public.applications (id) on delete set null,
  name text not null,
  category_id uuid references public.parade_categories (id),
  -- Lineup position, independent of staging location (FR-05, §6).
  sequence_number integer check (sequence_number > 0),
  group_label text,
  is_final_unit boolean not null default false,
  is_emergency_apparatus boolean not null default false,
  status public.unit_status not null default 'not_arrived',
  -- Complete occupied footprint, including towing vehicles and trailers (feet).
  footprint_length_ft numeric(7, 1) not null default 0 check (footprint_length_ft >= 0),
  footprint_width_ft numeric(6, 1) not null default 0 check (footprint_width_ft >= 0),
  separation_ft numeric(6, 1) not null default 25 check (separation_ft >= 0),
  -- Opaque identifier encoded in the QR pass. Contains no personal information.
  pass_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  public_visible boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, sequence_number) deferrable initially deferred
);

create unique index parade_units_one_final_idx on public.parade_units (event_id) where is_final_unit;
create index parade_units_event_status_idx on public.parade_units (event_id, status);

create trigger parade_units_touch before update on public.parade_units
  for each row execute function public.touch_updated_at();

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  unit_id uuid references public.parade_units (id) on delete set null,
  vehicle_type text not null,
  description text,
  length_ft numeric(6, 1) not null check (length_ft > 0),
  width_ft numeric(5, 1) check (width_ft > 0),
  height_ft numeric(5, 1) check (height_ft > 0),
  is_towing boolean not null default false,
  trailer_length_ft numeric(6, 1) not null default 0 check (trailer_length_ft >= 0),
  driver_name text,
  created_at timestamptz not null default now()
);

create index vehicles_application_idx on public.vehicles (application_id);

-- -----------------------------------------------------------------------------
-- Versioned configuration (FR-01): draft / approved / published snapshots.
-- -----------------------------------------------------------------------------

create table public.config_versions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind public.config_kind not null,
  stage public.config_stage not null,
  version_number integer not null,
  snapshot jsonb not null,
  notes text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (event_id, kind, version_number)
);

-- -----------------------------------------------------------------------------
-- Route (stored independently of staging geometry, §5)
-- -----------------------------------------------------------------------------

create table public.route_segments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  sequence integer not null check (sequence > 0),
  name text not null,
  geometry extensions.geometry(LineString, 4326) not null,
  length_ft numeric(8, 1) generated always as
    (round((extensions.st_length(geometry::extensions.geography) * 3.28084)::numeric, 1)) stored,
  field_validated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, sequence)
);

create trigger route_segments_touch before update on public.route_segments
  for each row execute function public.touch_updated_at();

create table public.checkpoints (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  code text not null,
  name text not null,
  sequence integer not null check (sequence > 0),
  location extensions.geometry(Point, 4326) not null,
  is_merge_point boolean not null default false,
  is_finish boolean not null default false,
  field_validated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (event_id, code),
  unique (event_id, sequence)
);

-- -----------------------------------------------------------------------------
-- Staging geometry (FR-03)
-- -----------------------------------------------------------------------------

create table public.staging_zones (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  code text not null,
  street_name text not null,
  description text,
  primary_use public.zone_use not null default 'general',
  geometry extensions.geometry(LineString, 4326),
  sort_order integer not null default 0,
  field_validated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, code)
);

create trigger staging_zones_touch before update on public.staging_zones
  for each row execute function public.touch_updated_at();

create table public.staging_lanes (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.staging_zones (id) on delete cascade,
  lane_number integer not null check (lane_number > 0),
  geometry extensions.geometry(LineString, 4326),
  width_ft numeric(5, 1) not null default 12 check (width_ft > 0),
  direction public.compass_direction not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (zone_id, lane_number)
);

create trigger staging_lanes_touch before update on public.staging_lanes
  for each row execute function public.touch_updated_at();

create table public.staging_blocks (
  id uuid primary key default gen_random_uuid(),
  lane_id uuid not null references public.staging_lanes (id) on delete cascade,
  block_number integer not null check (block_number > 0),
  -- Usable space measured along the lane.
  usable_length_ft numeric(7, 1) not null check (usable_length_ft > 0),
  permitted_width_ft numeric(5, 1) not null check (permitted_width_ft > 0),
  base_status public.segment_status not null default 'open',
  geometry extensions.geometry(LineString, 4326),
  accessibility_notes text,
  turning_notes text,
  restriction_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lane_id, block_number)
);

create trigger staging_blocks_touch before update on public.staging_blocks
  for each row execute function public.touch_updated_at();

create table public.staging_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  unit_id uuid not null references public.parade_units (id) on delete cascade,
  block_id uuid not null references public.staging_blocks (id) on delete restrict,
  -- Offset of the unit's front from the start of the block (feet).
  start_offset_ft numeric(7, 1) not null default 0 check (start_offset_ft >= 0),
  occupied_length_ft numeric(7, 1) not null check (occupied_length_ft > 0),
  status public.assignment_status not null default 'proposed',
  flag_reason text,
  override_reason text,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A staging assignment must not overlap another unit's reserved space (§6).
  constraint staging_assignments_no_overlap exclude using gist (
    block_id with =,
    numrange(start_offset_ft, start_offset_ft + occupied_length_ft) with &&
  ) where (status <> 'released')
);

create unique index staging_assignments_one_active_per_unit
  on public.staging_assignments (unit_id) where status <> 'released';

create trigger staging_assignments_touch before update on public.staging_assignments
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Restrictions (FR-04)
-- -----------------------------------------------------------------------------

create table public.restrictions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Exactly one target scope.
  zone_id uuid references public.staging_zones (id) on delete cascade,
  lane_id uuid references public.staging_lanes (id) on delete cascade,
  block_id uuid references public.staging_blocks (id) on delete cascade,
  status public.segment_status not null check (status <> 'open'),
  reason text not null check (length(trim(reason)) > 0),
  affected_area extensions.geometry(Geometry, 4326),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  responsible_authority text not null,
  document_path text,
  is_safety boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(zone_id, lane_id, block_id) = 1),
  check (effective_to is null or effective_to > effective_from)
);

create trigger restrictions_touch before update on public.restrictions
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Operations: dispatch, movement, incidents (FR-06, FR-07, FR-09)
-- -----------------------------------------------------------------------------

create table public.dispatch_authorizations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  unit_id uuid not null references public.parade_units (id) on delete cascade,
  is_active boolean not null default true,
  authorized_by uuid not null references public.profiles (id),
  authorized_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_reason text
);

-- One active release authorization at the merge at a time, and never two for one unit.
create unique index dispatch_authorizations_one_active_per_event
  on public.dispatch_authorizations (event_id) where is_active;
create unique index dispatch_authorizations_one_active_per_unit
  on public.dispatch_authorizations (unit_id) where is_active;

create table public.dispatch_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  unit_id uuid references public.parade_units (id) on delete set null,
  action public.dispatch_action not null,
  from_status public.unit_status,
  to_status public.unit_status,
  reason text,
  performed_by uuid not null references public.profiles (id),
  -- Device time of the action and server receipt time (offline tolerance, §6).
  recorded_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  client_action_id uuid unique,
  requires_resolution boolean not null default false,
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  resolution_note text
);

create index dispatch_events_event_idx on public.dispatch_events (event_id, received_at desc);

create table public.movement_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  unit_id uuid not null references public.parade_units (id) on delete cascade,
  checkpoint_id uuid not null references public.checkpoints (id) on delete cascade,
  source public.movement_source not null default 'marshal',
  reported_by uuid not null references public.profiles (id),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  client_action_id uuid unique,
  notes text,
  unique (unit_id, checkpoint_id)
);

create index movement_events_event_idx on public.movement_events (event_id, received_at desc);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  unit_id uuid references public.parade_units (id) on delete set null,
  checkpoint_id uuid references public.checkpoints (id) on delete set null,
  location extensions.geometry(Point, 4326),
  location_description text,
  severity public.incident_severity not null default 'low',
  status public.incident_status not null default 'open',
  summary text not null,
  details text,
  reported_by uuid not null references public.profiles (id) default auth.uid(),
  assigned_to uuid references public.profiles (id),
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger incidents_touch before update on public.incidents
  for each row execute function public.touch_updated_at();

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  audience public.announcement_audience not null,
  title text not null,
  body text not null,
  is_emergency boolean not null default false,
  published_at timestamptz,
  expires_at timestamptz,
  issued_by uuid not null references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_event_idx on public.announcements (event_id, audience, published_at desc);

create trigger announcements_touch before update on public.announcements
  for each row execute function public.touch_updated_at();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events (id) on delete cascade,
  recipient_id uuid references public.profiles (id) on delete cascade,
  recipient_address text,
  channel public.notification_channel not null default 'in_app',
  subject text not null,
  body text not null,
  related_table text,
  related_id uuid,
  status public.notification_status not null default 'pending',
  sent_at timestamptz,
  read_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- Public publication layer (§6): spectators only ever read approved snapshots.
create table public.publications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  version_number integer not null,
  payload jsonb not null,
  published_by uuid references public.profiles (id) default auth.uid(),
  published_at timestamptz not null default now(),
  unique (event_id, version_number)
);

-- -----------------------------------------------------------------------------
-- Audit log (§6, §7 Auditability)
-- -----------------------------------------------------------------------------

create table public.audit_logs (
  id bigint generated always as identity primary key,
  event_id uuid,
  actor_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  context text,
  created_at timestamptz not null default now()
);

create index audit_logs_event_idx on public.audit_logs (event_id, created_at desc);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);

create function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_event uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_event := case
    when tg_table_name = 'events' then (v_row ->> 'id')::uuid
    else nullif(v_row ->> 'event_id', '')::uuid
  end;
  insert into public.audit_logs (event_id, actor_id, table_name, record_id, action, old_data, new_data, context)
  values (
    v_event,
    auth.uid(),
    tg_table_name,
    nullif(v_row ->> 'id', '')::uuid,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    nullif(current_setting('app.audit_context', true), '')
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'events', 'event_roles', 'applications', 'parade_units', 'staging_zones', 'staging_lanes',
    'staging_blocks', 'staging_assignments', 'route_segments', 'checkpoints', 'restrictions',
    'dispatch_authorizations', 'incidents', 'announcements', 'publications', 'config_versions'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_roles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.parade_categories enable row level security;
alter table public.waivers enable row level security;
alter table public.applications enable row level security;
alter table public.parade_units enable row level security;
alter table public.vehicles enable row level security;
alter table public.config_versions enable row level security;
alter table public.route_segments enable row level security;
alter table public.checkpoints enable row level security;
alter table public.staging_zones enable row level security;
alter table public.staging_lanes enable row level security;
alter table public.staging_blocks enable row level security;
alter table public.staging_assignments enable row level security;
alter table public.restrictions enable row level security;
alter table public.dispatch_authorizations enable row level security;
alter table public.dispatch_events enable row level security;
alter table public.movement_events enable row level security;
alter table public.incidents enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.publications enable row level security;
alter table public.audit_logs enable row level security;

-- profiles --------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid() or public.is_system_admin()
    or exists (
      select 1 from public.event_roles r
      where public.is_event_staff(r.event_id) and r.user_id = profiles.id
    )
    or exists (
      select 1 from public.applications a
      where a.submitted_by = profiles.id and public.is_event_reviewer(a.event_id)
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_system_admin())
  with check (id = auth.uid() or public.is_system_admin());

-- events: non-draft events are publicly visible (name, dates); config is separate.
create policy events_select on public.events for select to anon, authenticated
  using (status <> 'draft' or public.is_event_staff(id));
create policy events_insert on public.events for insert to authenticated
  with check (public.is_system_admin());
create policy events_update on public.events for update to authenticated
  using (public.is_system_admin() or public.has_event_role(id, array['parade_director']::public.app_role[]))
  with check (public.is_system_admin() or public.has_event_role(id, array['parade_director']::public.app_role[]));
create policy events_delete on public.events for delete to authenticated
  using (public.is_system_admin());

-- event_roles: director grants roles for their event; admin everywhere.
create policy event_roles_select on public.event_roles for select to authenticated
  using (user_id = auth.uid() or public.is_event_staff(event_id));
create policy event_roles_write on public.event_roles for all to authenticated
  using (public.has_event_role(event_id, array['parade_director']::public.app_role[]))
  with check (public.has_event_role(event_id, array['parade_director']::public.app_role[]));

-- organizations ---------------------------------------------------------------
create policy organizations_select on public.organizations for select to authenticated
  using (
    created_by = auth.uid() or public.is_org_member(id) or public.is_system_admin()
    or exists (
      select 1 from public.applications a
      where a.organization_id = organizations.id and public.is_event_staff(a.event_id)
    )
  );
create policy organizations_insert on public.organizations for insert to authenticated
  with check (created_by = auth.uid());
create policy organizations_update on public.organizations for update to authenticated
  using (public.is_org_member(id) or public.is_system_admin())
  with check (public.is_org_member(id) or public.is_system_admin());

create policy org_members_select on public.organization_members for select to authenticated
  using (user_id = auth.uid() or public.is_org_member(organization_id) or public.is_system_admin());
create policy org_members_write on public.organization_members for all to authenticated
  using (
    public.is_system_admin() or exists (
      select 1 from public.organization_members m
      where m.organization_id = organization_members.organization_id
        and m.user_id = auth.uid() and m.is_owner
    )
  )
  with check (
    public.is_system_admin() or exists (
      select 1 from public.organization_members m
      where m.organization_id = organization_members.organization_id
        and m.user_id = auth.uid() and m.is_owner
    )
  );

-- categories & waivers: readable for visible events; director edits ----------
create policy categories_select on public.parade_categories for select to anon, authenticated
  using (exists (select 1 from public.events e where e.id = event_id));
create policy categories_write on public.parade_categories for all to authenticated
  using (public.is_event_director(event_id)) with check (public.is_event_director(event_id));

create policy waivers_select on public.waivers for select to anon, authenticated
  using (exists (select 1 from public.events e where e.id = event_id));
create policy waivers_write on public.waivers for all to authenticated
  using (public.is_event_director(event_id)) with check (public.is_event_director(event_id));

-- applications ----------------------------------------------------------------
create policy applications_select on public.applications for select to authenticated
  using (
    submitted_by = auth.uid() or public.is_org_member(organization_id)
    or public.is_event_staff(event_id)
  );
-- New applications start as drafts; status changes go through transition_application().
create policy applications_insert on public.applications for insert to authenticated
  with check (
    submitted_by = auth.uid() and status = 'draft' and public.is_org_member(organization_id)
  );
create policy applications_update on public.applications for update to authenticated
  using (
    ((submitted_by = auth.uid() or public.is_org_member(organization_id))
       and status in ('draft', 'needs_information'))
    or public.is_event_reviewer(event_id)
  )
  with check (
    ((submitted_by = auth.uid() or public.is_org_member(organization_id))
       and status in ('draft', 'needs_information'))
    or public.is_event_reviewer(event_id)
  );
create policy applications_delete on public.applications for delete to authenticated
  using (submitted_by = auth.uid() and status = 'draft');

-- Status, review and payment fields may only change through the transition RPC.
-- Runs as the invoking role: direct client writes arrive as "authenticated", while
-- the SECURITY DEFINER workflow functions run as the owner and pass through.
create function public.guard_application_fields() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.submitted_at is distinct from old.submitted_at
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at
     or new.event_id is distinct from old.event_id
     or new.submitted_by is distinct from old.submitted_by then
    raise exception 'Application status and review fields change only through transition_application()'
      using errcode = '42501';
  end if;
  if not public.is_event_reviewer(old.event_id)
     and (new.internal_notes is distinct from old.internal_notes
          or new.payment_status is distinct from old.payment_status) then
    raise exception 'Only reviewers may edit internal notes or payment status' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger applications_guard before update on public.applications
  for each row execute function public.guard_application_fields();

-- vehicles follow their application ------------------------------------------
create policy vehicles_select on public.vehicles for select to authenticated
  using (exists (
    select 1 from public.applications a where a.id = application_id
      and (a.submitted_by = auth.uid() or public.is_org_member(a.organization_id)
           or public.is_event_staff(a.event_id))
  ));
create policy vehicles_write on public.vehicles for all to authenticated
  using (exists (
    select 1 from public.applications a where a.id = application_id
      and (((a.submitted_by = auth.uid() or public.is_org_member(a.organization_id))
             and a.status in ('draft', 'needs_information'))
           or public.is_event_director(a.event_id))
  ))
  with check (exists (
    select 1 from public.applications a where a.id = application_id
      and (((a.submitted_by = auth.uid() or public.is_org_member(a.organization_id))
             and a.status in ('draft', 'needs_information'))
           or public.is_event_director(a.event_id))
  ));

-- parade units: staff read; participants read their own; director writes ------
create policy units_select on public.parade_units for select to authenticated
  using (
    public.is_event_staff(event_id) or exists (
      select 1 from public.applications a where a.id = application_id
        and (a.submitted_by = auth.uid() or public.is_org_member(a.organization_id))
    )
  );
create policy units_write on public.parade_units for all to authenticated
  using (public.is_event_director(event_id)) with check (public.is_event_director(event_id));

-- Operational geometry: staff read, director writes ---------------------------
create policy config_versions_select on public.config_versions for select to authenticated
  using (public.is_event_staff(event_id));
create policy config_versions_insert on public.config_versions for insert to authenticated
  with check (public.is_event_director(event_id));

create policy route_select on public.route_segments for select to authenticated
  using (public.is_event_staff(event_id));
create policy route_write on public.route_segments for all to authenticated
  using (public.is_event_director(event_id)) with check (public.is_event_director(event_id));

create policy checkpoints_select on public.checkpoints for select to authenticated
  using (public.is_event_staff(event_id));
create policy checkpoints_write on public.checkpoints for all to authenticated
  using (public.is_event_director(event_id)) with check (public.is_event_director(event_id));

create policy zones_select on public.staging_zones for select to authenticated
  using (public.is_event_staff(event_id));
create policy zones_write on public.staging_zones for all to authenticated
  using (public.is_event_director(event_id)) with check (public.is_event_director(event_id));

create policy lanes_select on public.staging_lanes for select to authenticated
  using (exists (select 1 from public.staging_zones z where z.id = zone_id and public.is_event_staff(z.event_id)));
create policy lanes_write on public.staging_lanes for all to authenticated
  using (exists (select 1 from public.staging_zones z where z.id = zone_id and public.is_event_director(z.event_id)))
  with check (exists (select 1 from public.staging_zones z where z.id = zone_id and public.is_event_director(z.event_id)));

create policy blocks_select on public.staging_blocks for select to authenticated
  using (exists (
    select 1 from public.staging_lanes l join public.staging_zones z on z.id = l.zone_id
    where l.id = lane_id and public.is_event_staff(z.event_id)
  ));
create policy blocks_write on public.staging_blocks for all to authenticated
  using (exists (
    select 1 from public.staging_lanes l join public.staging_zones z on z.id = l.zone_id
    where l.id = lane_id and public.is_event_director(z.event_id)
  ))
  with check (exists (
    select 1 from public.staging_lanes l join public.staging_zones z on z.id = l.zone_id
    where l.id = lane_id and public.is_event_director(z.event_id)
  ));

-- Only the Parade Director or delegated assistant approve placement (§6).
create policy assignments_select on public.staging_assignments for select to authenticated
  using (
    public.is_event_staff(event_id) or exists (
      select 1 from public.parade_units u join public.applications a on a.id = u.application_id
      where u.id = unit_id and a.status in ('assigned', 'checked_in', 'completed')
        and (a.submitted_by = auth.uid() or public.is_org_member(a.organization_id))
    )
  );
create policy assignments_write on public.staging_assignments for all to authenticated
  using (public.is_event_director(event_id)) with check (public.is_event_director(event_id));

-- Restrictions: director, assistant and public safety liaison -----------------
create policy restrictions_select on public.restrictions for select to authenticated
  using (public.is_event_staff(event_id));
create policy restrictions_write on public.restrictions for all to authenticated
  using (public.has_event_role(event_id,
    array['parade_director', 'assistant_director', 'public_safety_liaison']::public.app_role[]))
  with check (public.has_event_role(event_id,
    array['parade_director', 'assistant_director', 'public_safety_liaison']::public.app_role[]));

-- Dispatch & movement: read-only to staff; writes only via RPCs (0002) --------
create policy dispatch_auth_select on public.dispatch_authorizations for select to authenticated
  using (public.is_event_staff(event_id));
create policy dispatch_events_select on public.dispatch_events for select to authenticated
  using (public.is_event_staff(event_id));
create policy movement_select on public.movement_events for select to authenticated
  using (public.is_event_staff(event_id));

-- Incidents: any staff may report; leadership and safety manage --------------
create policy incidents_select on public.incidents for select to authenticated
  using (public.is_event_staff(event_id));
create policy incidents_insert on public.incidents for insert to authenticated
  with check (public.is_event_staff(event_id) and reported_by = auth.uid());
create policy incidents_update on public.incidents for update to authenticated
  using (public.has_event_role(event_id,
    array['parade_director', 'assistant_director', 'public_safety_liaison']::public.app_role[]))
  with check (public.has_event_role(event_id,
    array['parade_director', 'assistant_director', 'public_safety_liaison']::public.app_role[]));

-- Announcements ---------------------------------------------------------------
create policy announcements_public_select on public.announcements for select to anon, authenticated
  using (audience = 'public' and published_at is not null and published_at <= now()
         and (expires_at is null or expires_at > now()));
create policy announcements_participant_select on public.announcements for select to authenticated
  using (audience = 'participants' and published_at is not null and exists (
    select 1 from public.applications a
    where a.event_id = announcements.event_id
      and (a.submitted_by = auth.uid() or public.is_org_member(a.organization_id))
  ));
create policy announcements_staff_select on public.announcements for select to authenticated
  using (public.is_event_staff(event_id));
-- Emergency public instructions only from director or public safety liaison (FR-09).
create policy announcements_write on public.announcements for all to authenticated
  using (
    public.has_event_role(event_id, case when is_emergency
      then array['parade_director', 'public_safety_liaison']::public.app_role[]
      else array['parade_director', 'assistant_director', 'public_safety_liaison']::public.app_role[] end)
  )
  with check (
    issued_by = auth.uid() and
    public.has_event_role(event_id, case when is_emergency
      then array['parade_director', 'public_safety_liaison']::public.app_role[]
      else array['parade_director', 'assistant_director', 'public_safety_liaison']::public.app_role[] end)
  );

-- Notifications ----------------------------------------------------------------
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = auth.uid() or (event_id is not null and public.is_event_director(event_id)));
create policy notifications_mark_read on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- Publications: the only operational data spectators can read -----------------
create policy publications_select on public.publications for select to anon, authenticated
  using (true);

-- Audit log: leadership reads; writes come only from triggers -----------------
create policy audit_select on public.audit_logs for select to authenticated
  using (public.is_system_admin() or (event_id is not null and public.is_event_director(event_id)));
