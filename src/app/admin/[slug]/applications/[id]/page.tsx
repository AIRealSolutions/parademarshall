import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent, type ApplicationRow, type VehicleRow } from "@/lib/data";
import { feet, formatDateTime } from "@/lib/format";
import { computeFootprint } from "@/lib/domain/footprint";
import { availableTransitions } from "@/lib/domain/applications";
import { isDirector, isReviewer } from "@/lib/domain/roles";
import { Card, DefinitionList, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { ReviewPanel } from "@/components/review-panel";
import { AuditList, type AuditRow } from "@/components/audit-list";

export default async function ApplicationReview({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const supabase = await createClient();

  const { data: app } = await supabase
    .from("applications")
    .select("*, organizations(*), parade_categories(name)")
    .eq("id", id)
    .eq("event_id", event.id)
    .maybeSingle<ApplicationRow & {
      organizations: { name: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null; website: string | null };
      parade_categories: { name: string } | null;
    }>();
  if (!app) notFound();

  const [{ data: vehicles }, { data: units }, { data: audit }, { data: history }] = await Promise.all([
    supabase.from("vehicles").select("*").eq("application_id", id).order("created_at").returns<VehicleRow[]>(),
    supabase.from("parade_units").select("id, name, status, sequence_number, footprint_length_ft, separation_ft").eq("application_id", id),
    supabase
      .from("audit_logs")
      .select("id, created_at, action, table_name, context, actor_id, old_data, new_data, profiles:actor_id(full_name, email)")
      .eq("table_name", "applications")
      .eq("record_id", id)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<AuditRow[]>(),
    supabase
      .from("applications")
      .select("id, entry_name, status, events(year)")
      .eq("organization_id", app.organization_id)
      .neq("id", id),
  ]);

  const fp = computeFootprint(Number(app.footprint_length_ft), vehicles ?? [], Number(event.default_separation_ft));
  const transitions = availableTransitions(app.status, {
    isOwner: false,
    isReviewer: isReviewer(access),
    isDirector: isDirector(access),
  });

  return (
    <>
      <p className="mb-3 text-sm">
        <Link href={`/admin/${slug}/applications`} className="text-brand hover:underline">
          ← Applications
        </Link>
      </p>
      <PageHeader
        title={app.entry_name}
        subtitle={`${app.organizations.name} · ${app.parade_categories?.name ?? "No category"}`}
        actions={<StatusBadge status={app.status} />}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {app.status_note && (
            <Notice tone="info">
              <span className="font-medium">Latest note:</span> {app.status_note}
            </Notice>
          )}
          <Card title="Entry">
            <DefinitionList
              items={[
                ["Purpose", app.purpose],
                ["Participants", app.participant_count],
                ["Responsible contact", app.responsible_contact_name],
                ["Phone", <a key="p" href={`tel:${app.responsible_contact_phone}`} className="text-brand hover:underline">{app.responsible_contact_phone}</a>],
                ["Email", <a key="e" href={`mailto:${app.responsible_contact_email}`} className="text-brand hover:underline">{app.responsible_contact_email}</a>],
                ["Submitted", formatDateTime(app.submitted_at, event.timezone)],
                ["Acknowledgment", app.waiver_accepted_at ? `${app.waiver_accepted_name}, ${formatDateTime(app.waiver_accepted_at, event.timezone)}` : "Not accepted"],
                ["Payment", "Not required (fees disabled)"],
              ]}
            />
          </Card>

          <Card title="Footprint & vehicles">
            <div className="mb-4 grid grid-cols-3 gap-3 text-center">
              <Metric label="Declared" value={feet(app.footprint_length_ft)} />
              <Metric label="Vehicles + trailers" value={feet(fp.vehicleLengthFt)} />
              <Metric label="Staging reserve" value={feet(fp.requiredStagingLengthFt)} strong />
            </div>
            <p className="mb-3 text-xs text-muted">
              Staging reserve = larger of declared and vehicle length, plus {feet(event.default_separation_ft)} separation.
              Widest point {feet(app.footprint_width_ft)}.
            </p>
            {vehicles && vehicles.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted uppercase">
                    <tr>
                      <th className="py-1 font-medium">Vehicle</th>
                      <th className="py-1 text-right font-medium">L</th>
                      <th className="py-1 text-right font-medium">W</th>
                      <th className="py-1 text-right font-medium">H</th>
                      <th className="py-1 text-right font-medium">Trailer</th>
                      <th className="py-1 font-medium">Driver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {vehicles.map((v) => (
                      <tr key={v.id}>
                        <td className="py-1.5">{v.vehicle_type}</td>
                        <td className="py-1.5 text-right tabular-nums">{feet(v.length_ft)}</td>
                        <td className="py-1.5 text-right tabular-nums">{feet(v.width_ft)}</td>
                        <td className="py-1.5 text-right tabular-nums">{feet(v.height_ft)}</td>
                        <td className="py-1.5 text-right tabular-nums">{v.is_towing ? feet(v.trailer_length_ft) : "—"}</td>
                        <td className="py-1.5">{v.driver_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">No vehicles.</p>
            )}
          </Card>

          <Card title="Safety & accessibility">
            <DefinitionList
              items={[
                ["Animals", app.has_animals ? "Yes" : "No"],
                ["Amplified sound", app.has_amplified_sound ? "Yes" : "No"],
                ["Safety requirements", app.safety_requirements],
                ["Accessibility needs", app.accessibility_needs],
              ]}
            />
          </Card>

          <Card title="Public profile">
            <p className="mb-3 text-xs text-muted">Shown to spectators only after the director publishes the lineup.</p>
            <DefinitionList items={[["Public name", app.public_name || app.entry_name], ["Description", app.public_description]]} />
          </Card>

          <Card title="History">
            <AuditList rows={audit ?? []} timezone={event.timezone} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Review">
            <ReviewPanel applicationId={app.id} status={app.status} transitions={transitions} />
          </Card>
          {units && units.length > 0 && (
            <Card title="Parade units">
              <ul className="space-y-2 text-sm">
                {units.map((u) => (
                  <li key={u.id} className="flex justify-between gap-2">
                    <span>{u.name}</span>
                    <span className="text-muted capitalize">{u.status.replace(/_/g, " ")}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">Staging placement and lineup order arrive in Phase 2–3.</p>
            </Card>
          )}
          <Card title="Organization">
            <DefinitionList
              items={[
                ["Name", app.organizations.name],
                ["Contact", app.organizations.contact_name],
                ["Email", app.organizations.contact_email],
                ["Phone", app.organizations.contact_phone],
              ]}
            />
            {history && history.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-xs font-medium text-muted uppercase">Other entries</p>
                <ul className="space-y-1 text-sm">
                  {history.map((h) => (
                    <li key={h.id}>
                      {(h.events as unknown as { year: number }).year} · {h.entry_name}{" "}
                      <span className="text-muted">({h.status.replace(/_/g, " ")})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Metric({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <div className={`rounded-md p-2 ${strong ? "bg-brand/10" : "bg-stone-50"}`}>
      <p className="text-[11px] text-muted uppercase">{label}</p>
      <p className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{value ?? "—"}</p>
    </div>
  );
}
