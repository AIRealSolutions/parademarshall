import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EventRole, StaffAccess } from "@/lib/domain/roles";
import type { ApplicationStatus } from "@/lib/domain/applications";

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  year: number;
  municipality: string | null;
  host_organization: string | null;
  timezone: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  default_separation_ft: number;
  settings: Record<string, unknown>;
  parade_hold: boolean;
  parade_hold_reason: string | null;
}

export interface ApplicationRow {
  id: string;
  event_id: string;
  organization_id: string;
  submitted_by: string;
  entry_name: string;
  purpose: string | null;
  category_id: string | null;
  responsible_contact_name: string;
  responsible_contact_phone: string;
  responsible_contact_email: string;
  participant_count: number;
  footprint_length_ft: number;
  footprint_width_ft: number;
  has_animals: boolean;
  has_amplified_sound: boolean;
  safety_requirements: string | null;
  accessibility_needs: string | null;
  public_name: string | null;
  public_description: string | null;
  status: ApplicationStatus;
  status_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  waiver_id: string | null;
  waiver_accepted_at: string | null;
  waiver_accepted_name: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface VehicleRow {
  id: string;
  vehicle_type: string;
  description: string | null;
  length_ft: number;
  width_ft: number | null;
  height_ft: number | null;
  is_towing: boolean;
  trailer_length_ft: number;
  driver_name: string | null;
}

export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export async function requireUser(next: string) {
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export const getEventBySlug = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from("events").select("*").eq("slug", slug).maybeSingle<EventRow>();
  return data;
});

export const getStaffAccess = cache(async (eventId: string): Promise<StaffAccess> => {
  const user = await getUser();
  if (!user) return { roles: [], isSystemAdmin: false };
  const supabase = await createClient();
  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from("event_roles").select("role").eq("event_id", eventId).eq("user_id", user.id),
    supabase.from("profiles").select("is_system_admin").eq("id", user.id).maybeSingle(),
  ]);
  return {
    roles: (roles ?? []).map((r) => r.role as EventRole),
    isSystemAdmin: Boolean(profile?.is_system_admin),
  };
});

/** Loads the event and the caller's staff access, or 404s for non-staff. */
export async function requireStaffEvent(slug: string) {
  await requireUser(`/admin/${slug}`);
  const event = await getEventBySlug(slug);
  if (!event) notFound();
  const access = await getStaffAccess(event.id);
  if (!access.isSystemAdmin && access.roles.length === 0) notFound();
  return { event, access };
}

export function registrationOpen(event: EventRow, now = new Date()) {
  if (event.status !== "registration_open") return false;
  if (event.registration_opens_at && new Date(event.registration_opens_at) > now) return false;
  if (event.registration_closes_at && new Date(event.registration_closes_at) <= now) return false;
  return true;
}
