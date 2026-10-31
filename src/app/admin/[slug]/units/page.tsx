import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { isDirector } from "@/lib/domain/roles";
import { PageHeader } from "@/components/ui";
import { UnitRegistry, type RegistryUnit } from "./unit-registry";

export default async function UnitsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const supabase = await createClient();
  const { data } = await supabase
    .from("parade_units")
    .select(
      "id, name, sequence_number, status, group_label, is_final_unit, is_emergency_apparatus, public_visible, notes, footprint_length_ft, footprint_width_ft, separation_ft, application_id, applications(id, entry_name, status, organizations(name)), parade_categories(name), vehicles(id, vehicle_type, length_ft, trailer_length_ft), staging_assignments(status, staging_blocks(block_number, staging_lanes(lane_number, staging_zones(street_name))))",
    )
    .eq("event_id", event.id)
    .order("sequence_number", { ascending: true, nullsFirst: false })
    .order("name");

  const units: RegistryUnit[] = (data ?? []).map((u) => {
    const app = u.applications as unknown as { id: string; entry_name: string; status: string; organizations: { name: string } } | null;
    const assignment = (u.staging_assignments as unknown as {
      status: string;
      staging_blocks: { block_number: number; staging_lanes: { lane_number: number; staging_zones: { street_name: string } } };
    }[]).find((a) => a.status !== "released");
    return {
      id: u.id,
      name: u.name,
      sequence_number: u.sequence_number,
      status: u.status,
      group_label: u.group_label,
      is_final_unit: u.is_final_unit,
      is_emergency_apparatus: u.is_emergency_apparatus,
      public_visible: u.public_visible,
      notes: u.notes,
      footprint_length_ft: Number(u.footprint_length_ft),
      footprint_width_ft: Number(u.footprint_width_ft),
      separation_ft: Number(u.separation_ft),
      application_id: app?.id ?? null,
      entry_name: app?.entry_name ?? null,
      organization: app?.organizations?.name ?? null,
      category: (u.parade_categories as unknown as { name: string } | null)?.name ?? null,
      vehicles: (u.vehicles as unknown as { id: string; vehicle_type: string; length_ft: number; trailer_length_ft: number }[]) ?? [],
      staging: assignment
        ? `${assignment.staging_blocks.staging_lanes.staging_zones.street_name} L${assignment.staging_blocks.staging_lanes.lane_number} B${assignment.staging_blocks.block_number} (${assignment.status})`
        : null,
    };
  });

  return (
    <>
      <PageHeader
        title="Unit Registry"
        subtitle="Units are created when an entry is approved. Split multi-vehicle entries into separately dispatched units here."
        actions={
          <Link href={`/admin/${slug}/units/passes`} className="text-sm text-brand hover:underline">
            Print passes →
          </Link>
        }
      />
      <UnitRegistry slug={slug} units={units} canEdit={isDirector(access)} />
    </>
  );
}
