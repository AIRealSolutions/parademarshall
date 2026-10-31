import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEventBySlug, getStaffAccess } from "@/lib/data";

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything; neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) return new NextResponse("Not found", { status: 404 });
  const access = await getStaffAccess(event.id);
  if (!access.isSystemAdmin && access.roles.length === 0) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("parade_units")
    .select(
      "sequence_number, name, status, footprint_length_ft, separation_ft, footprint_width_ft, is_emergency_apparatus, group_label, parade_categories(name), applications(entry_name, status, participant_count, responsible_contact_name, responsible_contact_phone, organizations(name)), staging_assignments(status, start_offset_ft, staging_blocks(block_number, staging_lanes(lane_number, staging_zones(street_name))))",
    )
    .eq("event_id", event.id)
    .order("sequence_number", { ascending: true, nullsFirst: false });
  if (error) return new NextResponse(error.message, { status: 500 });

  const header = ["Sequence", "Unit", "Status", "Category", "Organization", "Entry", "Application status", "Participants", "Length ft", "Separation ft", "Width ft", "Apparatus", "Group", "Staging street", "Lane", "Block", "Offset ft", "Placement status", "Contact", "Contact phone"];
  const rows = (data ?? []).map((u) => {
    const app = u.applications as unknown as {
      entry_name: string; status: string; participant_count: number; responsible_contact_name: string; responsible_contact_phone: string; organizations: { name: string };
    } | null;
    const a = (u.staging_assignments as unknown as {
      status: string; start_offset_ft: number; staging_blocks: { block_number: number; staging_lanes: { lane_number: number; staging_zones: { street_name: string } } };
    }[]).find((x) => x.status !== "released");
    return [
      u.sequence_number, u.name, u.status, (u.parade_categories as unknown as { name: string } | null)?.name, app?.organizations?.name, app?.entry_name,
      app?.status, app?.participant_count, u.footprint_length_ft, u.separation_ft, u.footprint_width_ft, u.is_emergency_apparatus ? "yes" : "", u.group_label,
      a?.staging_blocks.staging_lanes.staging_zones.street_name, a?.staging_blocks.staging_lanes.lane_number, a?.staging_blocks.block_number, a?.start_offset_ft, a?.status,
      app?.responsible_contact_name, app?.responsible_contact_phone,
    ];
  });
  const body = [header, ...rows].map((r) => r.map(csv).join(",")).join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-units.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
