import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { isChiefDirector, isDirector } from "@/lib/domain/roles";
import { stagedPositions, type StagingLayout } from "@/lib/domain/staging";
import { PageHeader } from "@/components/ui";
import { LineupBuilder, type LineupUnit } from "./lineup-builder";

export default async function LineupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const supabase = await createClient();

  const [{ data: units }, { data: layout }, { data: pubs }] = await Promise.all([
    supabase
      .from("parade_units")
      .select("id, name, sequence_number, status, group_label, is_final_unit, is_emergency_apparatus, applications(status), parade_categories(name)")
      .eq("event_id", event.id)
      .neq("status", "withdrawn")
      .order("sequence_number", { ascending: true, nullsFirst: false })
      .order("name"),
    supabase.rpc("staging_layout", { p_event_id: event.id }),
    supabase.from("publications").select("version_number, published_at").eq("event_id", event.id).order("version_number", { ascending: false }).limit(1),
  ]);

  const positions = layout ? stagedPositions(layout as StagingLayout) : new Map();
  const lineupUnits: LineupUnit[] = (units ?? [])
    .filter((u) => {
      const s = (u.applications as unknown as { status: string } | null)?.status;
      return !s || ["approved", "assigned", "checked_in", "completed"].includes(s);
    })
    .map((u) => ({
      id: u.id,
      name: u.name,
      sequence_number: u.sequence_number,
      status: u.status,
      group_label: u.group_label,
      is_final_unit: u.is_final_unit,
      is_emergency_apparatus: u.is_emergency_apparatus,
      category: (u.parade_categories as unknown as { name: string } | null)?.name ?? null,
      staging: positions.get(u.id) ?? null,
    }));

  const lastPub = pubs?.[0];
  return (
    <>
      <PageHeader
        title="Lineup Builder"
        subtitle={
          lastPub
            ? `Public lineup v${lastPub.version_number} published ${formatDateTime(lastPub.published_at, event.timezone)}`
            : "The public lineup has not been published yet."
        }
      />
      <LineupBuilder eventId={event.id} units={lineupUnits} canEdit={isDirector(access)} canPublish={isChiefDirector(access)} />
    </>
  );
}
