import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { isChiefDirector, isDirector } from "@/lib/domain/roles";
import { PageHeader } from "@/components/ui";
import { VolunteerManager, type StaffMember } from "./volunteer-manager";

export default async function VolunteersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const supabase = await createClient();
  const [{ data: roles }, { data: assignments }, { data: cps }, { data: zones }] = await Promise.all([
    supabase.from("event_roles").select("id, role, user_id, profiles:user_id(full_name, email, phone)").eq("event_id", event.id),
    supabase
      .from("volunteer_assignments")
      .select("id, user_id, position, shift_start, shift_end, notes, checkpoints(name), staging_zones(street_name)")
      .eq("event_id", event.id)
      .order("shift_start", { ascending: true, nullsFirst: false }),
    supabase.from("checkpoints").select("id, name").eq("event_id", event.id).order("sequence"),
    supabase.from("staging_zones").select("id, street_name").eq("event_id", event.id).order("sort_order"),
  ]);

  const people = new Map<string, StaffMember>();
  for (const r of roles ?? []) {
    const p = r.profiles as unknown as { full_name: string | null; email: string | null; phone: string | null } | null;
    const m: StaffMember = people.get(r.user_id) ?? { user_id: r.user_id, name: p?.full_name || p?.email || "Unknown", email: p?.email ?? null, phone: p?.phone ?? null, roles: [], assignments: [] };
    m.roles.push({ id: r.id, role: r.role });
    people.set(r.user_id, m);
  }
  for (const a of assignments ?? []) {
    const m = people.get(a.user_id);
    if (!m) continue;
    const where = (a.checkpoints as unknown as { name: string } | null)?.name ?? (a.staging_zones as unknown as { street_name: string } | null)?.street_name ?? null;
    m.assignments.push({ id: a.id, position: a.position, where, shift_start: a.shift_start, shift_end: a.shift_end, notes: a.notes });
  }

  return (
    <>
      <PageHeader title="Volunteers" subtitle="Staff roles control what each person can do. Positions and shifts are for the roster." />
      <VolunteerManager
        eventId={event.id}
        timezone={event.timezone}
        canGrant={isChiefDirector(access)}
        canAssign={isDirector(access)}
        staff={[...people.values()].sort((a, b) => a.name.localeCompare(b.name))}
        checkpoints={cps ?? []}
        zones={zones ?? []}
      />
    </>
  );
}
