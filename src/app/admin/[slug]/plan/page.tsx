import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS, type EventRole } from "@/lib/domain/roles";
import { stagedPositions, type StagingLayout } from "@/lib/domain/staging";
import { PrintButton } from "@/components/print-button";

// §6: staff must be able to export a complete printable operational plan
// before parade day. This page is the paper fallback if connectivity fails.
export default async function OperationalPlan({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await requireStaffEvent(slug);
  const supabase = await createClient();
  const [{ data: layoutData }, { data: units }, { data: roles }, { data: versions }] = await Promise.all([
    supabase.rpc("staging_layout", { p_event_id: event.id }),
    supabase
      .from("parade_units")
      .select("id, name, sequence_number, status, footprint_length_ft, separation_ft, is_emergency_apparatus, is_final_unit, group_label, parade_categories(name), applications(responsible_contact_name, responsible_contact_phone, participant_count, has_animals)")
      .eq("event_id", event.id)
      .neq("status", "withdrawn")
      .order("sequence_number", { ascending: true, nullsFirst: false }),
    supabase.from("event_roles").select("role, profiles:user_id(full_name, email, phone)").eq("event_id", event.id),
    supabase.from("config_versions").select("version_number, stage, created_at, notes").eq("event_id", event.id).eq("kind", "staging").order("version_number", { ascending: false }).limit(1),
  ]);
  const layout = layoutData as StagingLayout | null;
  const positions = layout ? stagedPositions(layout) : new Map();
  const v = versions?.[0];

  return (
    <article className="space-y-8 bg-white text-[13px] leading-snug print:text-[11px]">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {event.year} {event.name}: Operational Plan
          </h1>
          <p className="text-muted">
            {event.starts_at ? formatDateTime(event.starts_at, event.timezone) : "Date to be confirmed"} · Printed {formatDateTime(new Date().toISOString(), event.timezone)}
            {v && ` · Staging plan v${v.version_number} (${v.stage})`}
          </p>
          <p className="mt-1 font-medium">CONFIDENTIAL: contains participant contact information.</p>
        </div>
        <PrintButton />
      </header>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Lineup &amp; staging</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-foreground text-left">
              <th className="py-1 pr-2">#</th>
              <th className="py-1 pr-2">Unit</th>
              <th className="py-1 pr-2">Category</th>
              <th className="py-1 pr-2">Staging</th>
              <th className="py-1 pr-2 text-right">Length</th>
              <th className="py-1 pr-2">Contact</th>
              <th className="py-1 pr-2">Notes</th>
              <th className="py-1">✓</th>
            </tr>
          </thead>
          <tbody>
            {(units ?? []).map((u) => {
              const app = u.applications as unknown as { responsible_contact_name: string; responsible_contact_phone: string; participant_count: number; has_animals: boolean } | null;
              const p = positions.get(u.id);
              return (
                <tr key={u.id} className="border-b border-border break-inside-avoid">
                  <td className="py-1 pr-2 font-mono">{u.sequence_number ?? "—"}</td>
                  <td className="py-1 pr-2 font-medium">{u.name}</td>
                  <td className="py-1 pr-2">{(u.parade_categories as unknown as { name: string } | null)?.name}</td>
                  <td className="py-1 pr-2">{p ? `${p.lane_label} B${p.block_number} @${p.start_offset_ft}ft` : "UNPLACED"}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{Number(u.footprint_length_ft) + Number(u.separation_ft)} ft</td>
                  <td className="py-1 pr-2">
                    {app?.responsible_contact_name}
                    <br />
                    {app?.responsible_contact_phone}
                  </td>
                  <td className="py-1 pr-2">
                    {[u.is_emergency_apparatus && "Apparatus", u.is_final_unit && "FINAL UNIT", app?.has_animals && "Animals", u.group_label, app?.participant_count ? `${app.participant_count} people` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td className="py-1">☐</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {layout && (
        <section className="break-before-page">
          <h2 className="mb-2 text-lg font-semibold">Staging by street</h2>
          {layout.zones.map((z) => (
            <div key={z.id} className="mb-4 break-inside-avoid">
              <h3 className="font-semibold">
                {z.street_name} <span className="font-normal text-muted">({z.primary_use.replace("_", " ")}{z.field_validated ? "" : ", NOT field-validated"})</span>
              </h3>
              {z.lanes.map((l) => (
                <div key={l.id} className="ml-3">
                  <p className="font-medium">
                    Lane {l.lane_number} ({l.direction})
                  </p>
                  <ul className="ml-4 list-disc">
                    {l.blocks.map((b) => (
                      <li key={b.id}>
                        Block {b.block_number}: {b.usable_length_ft} ft, {b.effective_status.replace("_", " ")}
                        {b.assignments.length > 0 && ` · ${b.assignments.map((a) => `${a.sequence_number ? `#${a.sequence_number} ` : ""}${a.unit_name} @${a.start_offset_ft}ft`).join("; ")}`}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {layout && (
        <section className="break-inside-avoid">
          <h2 className="mb-2 text-lg font-semibold">Restrictions</h2>
          <ul className="ml-4 list-disc">
            {layout.restrictions.filter((r) => r.active).map((r) => (
              <li key={r.id}>
                {r.status.replace("_", " ")}{r.is_safety ? " (safety)" : ""}: {r.reason} [{r.responsible_authority}]
              </li>
            ))}
            {layout.restrictions.filter((r) => r.active).length === 0 && <li>None active.</li>}
          </ul>
          <h2 className="mt-4 mb-2 text-lg font-semibold">Checkpoints</h2>
          <ol className="ml-4 list-decimal">
            {layout.checkpoints.map((c) => (
              <li key={c.id}>
                {c.name}
                {c.field_validated ? "" : " (placement not field-validated)"}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="break-inside-avoid">
        <h2 className="mb-2 text-lg font-semibold">Staff contacts</h2>
        <table className="w-full border-collapse">
          <tbody>
            {(roles ?? []).map((r, i) => {
              const p = r.profiles as unknown as { full_name: string | null; email: string | null; phone: string | null } | null;
              return (
                <tr key={i} className="border-b border-border">
                  <td className="py-1 pr-2">{ROLE_LABELS[r.role as EventRole]}</td>
                  <td className="py-1 pr-2">{p?.full_name}</td>
                  <td className="py-1 pr-2">{p?.phone}</td>
                  <td className="py-1">{p?.email}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-4 text-xs">
          This plan supports, and does not replace, police, fire, emergency communications and incident command procedures.
        </p>
      </section>
    </article>
  );
}
