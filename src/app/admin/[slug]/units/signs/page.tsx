import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { isDirector } from "@/lib/domain/roles";
import { passUrl } from "@/lib/pass";
import { siteOrigin } from "@/lib/site-origin";
import { DashboardSign, SignPrintStyles } from "@/components/pass/dashboard-sign";
import { PrintButton } from "@/components/print-button";
import { Notice } from "@/components/ui";

// Every unit's full-page windshield sign, one per printed page, for the committee
// to hand out with hard-copy packets.
export default async function AllSignsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  if (!isDirector(access)) return <Notice tone="warn">Signs can be printed by the director or assistant director.</Notice>;

  const supabase = await createClient();
  const { data: units } = await supabase
    .from("parade_units")
    .select("id, name, sequence_number, pass_token, staging_assignments(status, staging_blocks(block_number, staging_lanes(lane_number, staging_zones(street_name))))")
    .eq("event_id", event.id)
    .not("status", "in", "(withdrawn,finished)")
    .order("sequence_number", { ascending: true, nullsFirst: false });
  const origin = await siteOrigin();

  return (
    <div className="space-y-6">
      <SignPrintStyles />
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard signs</h1>
          <p className="text-sm text-muted">{units?.length ?? 0} units · US Letter, landscape, one sign per page.</p>
        </div>
        <PrintButton label="Print all signs" />
      </div>
      {(units ?? []).map((u) => {
        const a = (u.staging_assignments as unknown as {
          status: string;
          staging_blocks: { block_number: number; staging_lanes: { lane_number: number; staging_zones: { street_name: string } } };
        }[]).find((x) => x.status === "approved");
        return (
          <div key={u.id} className="overflow-x-auto print:overflow-visible">
            <div className="mx-auto w-fit shadow-lg print:shadow-none">
              <DashboardSign
                url={passUrl(u.pass_token, origin)}
                eventTitle={`${event.year} ${event.name}`}
                unitName={u.name}
                sequence={u.sequence_number}
                staging={
                  a
                    ? `${a.staging_blocks.staging_lanes.staging_zones.street_name} · Lane ${a.staging_blocks.staging_lanes.lane_number} · Block ${a.staging_blocks.block_number}`
                    : null
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
