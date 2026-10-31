import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { SafetyConsole, type Incident, type Restriction, type Target } from "./safety-console";

export default async function SafetyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const supabase = await createClient();
  const [{ data: incidents }, { data: restrictions }, { data: zones }, { data: units }, { data: cps }] = await Promise.all([
    supabase
      .from("incidents")
      .select("id, summary, details, severity, status, resolution, created_at, location_description, parade_units(name), checkpoints(name), profiles:reported_by(full_name, email)")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("restrictions")
      .select("id, status, reason, is_safety, responsible_authority, effective_from, effective_to, zone_id, lane_id, block_id")
      .eq("event_id", event.id)
      .order("effective_from", { ascending: false }),
    supabase
      .from("staging_zones")
      .select("id, street_name, staging_lanes(id, lane_number, staging_blocks(id, block_number))")
      .eq("event_id", event.id)
      .order("sort_order"),
    supabase.from("parade_units").select("id, name, sequence_number").eq("event_id", event.id).neq("status", "withdrawn").order("sequence_number"),
    supabase.from("checkpoints").select("id, name").eq("event_id", event.id).order("sequence"),
  ]);

  // Flatten zones/lanes/blocks into labeled restriction targets.
  const targets: Target[] = [];
  for (const z of zones ?? []) {
    targets.push({ kind: "zone", id: z.id, label: `${z.street_name} (entire street)` });
    for (const l of (z.staging_lanes as unknown as { id: string; lane_number: number; staging_blocks: { id: string; block_number: number }[] }[]).sort((a, b) => a.lane_number - b.lane_number)) {
      targets.push({ kind: "lane", id: l.id, label: `${z.street_name} lane ${l.lane_number}` });
      for (const b of l.staging_blocks.sort((a, c) => a.block_number - c.block_number))
        targets.push({ kind: "block", id: b.id, label: `${z.street_name} lane ${l.lane_number} block ${b.block_number}` });
    }
  }
  const label = new Map(targets.map((t) => [t.id, t.label]));
  const can = (...r: string[]) => access.isSystemAdmin || access.roles.some((x) => r.includes(x));

  return (
    <>
      <PageHeader title="Safety & Alerts" subtitle="Incidents and street restrictions. This system supports, and does not replace, incident command." />
      <SafetyConsole
        eventId={event.id}
        timezone={event.timezone}
        canManage={can("parade_director", "assistant_director", "public_safety_liaison")}
        incidents={(incidents ?? []) as unknown as Incident[]}
        restrictions={(restrictions ?? []).map((r) => ({ ...r, target: label.get(r.block_id ?? r.lane_id ?? r.zone_id) ?? "Unknown" })) as Restriction[]}
        targets={targets}
        units={units ?? []}
        checkpoints={cps ?? []}
      />
    </>
  );
}
