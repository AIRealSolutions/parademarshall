import Link from "next/link";
import QRCode from "qrcode";
import { passUrl } from "@/lib/pass";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { isDirector } from "@/lib/domain/roles";
import { Notice } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export default async function PassesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  if (!isDirector(access)) return <Notice tone="warn">Passes can be printed by the director or assistant director.</Notice>;

  const supabase = await createClient();
  const { data: units } = await supabase
    .from("parade_units")
    .select("id, name, sequence_number, pass_token, staging_assignments(status, staging_blocks(block_number, staging_lanes(lane_number, staging_zones(street_name))))")
    .eq("event_id", event.id)
    .not("status", "in", "(withdrawn,finished)")
    .order("sequence_number", { ascending: true, nullsFirst: false });

  const origin = await siteOrigin();
  const passes = await Promise.all(
    (units ?? []).map(async (u) => ({
      ...u,
      svg: await QRCode.toString(passUrl(u.pass_token, origin), { type: "svg", margin: 1 }),
      place: (u.staging_assignments as unknown as {
        status: string;
        staging_blocks: { block_number: number; staging_lanes: { lane_number: number; staging_zones: { street_name: string } } };
      }[]).find((a) => a.status === "approved"),
    })),
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-semibold">Unit passes</h1>
        <div className="flex items-center gap-4">
          <Link href={`/admin/${slug}/units/signs`} className="text-sm text-brand hover:underline">
            Dashboard signs (one page per unit) →
          </Link>
          <PrintButton />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 print:grid-cols-3">
        {passes.map((u) => (
          <div key={u.id} className="break-inside-avoid rounded-md border border-border bg-white p-3 text-center">
            <p className="text-xs text-muted">
              {event.year} {event.name}
            </p>
            <div className="mx-auto my-2 w-36" dangerouslySetInnerHTML={{ __html: u.svg }} />
            <p className="font-semibold">{u.name}</p>
            <p className="text-sm">{u.sequence_number ? `Lineup #${u.sequence_number}` : "Lineup TBD"}</p>
            {u.place && (
              <p className="text-xs">
                {u.place.staging_blocks.staging_lanes.staging_zones.street_name} · L{u.place.staging_blocks.staging_lanes.lane_number} · B
                {u.place.staging_blocks.block_number}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
