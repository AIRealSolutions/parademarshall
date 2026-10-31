import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { isChiefDirector, isDirector } from "@/lib/domain/roles";
import type { StagingLayout } from "@/lib/domain/staging";
import { Notice, PageHeader } from "@/components/ui";
import { StagingWorkspace, type StagingUnit } from "./staging-workspace";

export default async function StagingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const supabase = await createClient();

  const [{ data: layout, error }, { data: units }, { data: versions }] = await Promise.all([
    supabase.rpc("staging_layout", { p_event_id: event.id }),
    supabase
      .from("parade_units")
      .select("id, name, sequence_number, status, footprint_length_ft, footprint_width_ft, separation_ft, is_emergency_apparatus, applications(status, entry_name, parade_categories(name))")
      .eq("event_id", event.id)
      .neq("status", "withdrawn")
      .order("sequence_number", { ascending: true, nullsFirst: false }),
    supabase
      .from("config_versions")
      .select("version_number, stage, notes, created_at")
      .eq("event_id", event.id)
      .eq("kind", "staging")
      .order("version_number", { ascending: false })
      .limit(5),
  ]);
  if (error || !layout) return <Notice tone="bad">Could not load staging: {error?.message}</Notice>;

  const stagingUnits: StagingUnit[] = (units ?? []).map((u) => {
    const app = u.applications as unknown as { status: string; entry_name: string; parade_categories: { name: string } | null } | null;
    return {
      id: u.id,
      name: u.name,
      sequence_number: u.sequence_number,
      status: u.status,
      footprint_length_ft: Number(u.footprint_length_ft),
      footprint_width_ft: Number(u.footprint_width_ft),
      separation_ft: Number(u.separation_ft),
      is_emergency_apparatus: u.is_emergency_apparatus,
      category: app?.parade_categories?.name ?? null,
      application_status: app?.status ?? null,
    };
  });

  return (
    <>
      <PageHeader
        title="Staging Map"
        subtitle="Click a block to place units. Colors show each block's current status, including active restrictions."
      />
      <StagingWorkspace
        eventId={event.id}
        layout={layout as StagingLayout}
        units={stagingUnits}
        versions={versions ?? []}
        canEdit={isDirector(access)}
        canApprovePlan={isChiefDirector(access)}
      />
    </>
  );
}
