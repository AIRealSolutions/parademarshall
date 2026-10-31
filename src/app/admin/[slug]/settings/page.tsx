import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { toLocalInput } from "@/lib/format";
import { isChiefDirector, isDirector } from "@/lib/domain/roles";
import { Card, Notice, PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";
import { CategoryEditor, CloneEventForm } from "./config-editors";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("parade_categories")
    .select("id, name, is_active")
    .eq("event_id", event.id)
    .order("sort_order");
  const canEdit = isChiefDirector(access);
  const s = event.settings as Record<string, unknown>;

  return (
    <>
      <PageHeader title="Event Settings" />
      <div className="space-y-6">
        {s.dates_confirmed === false && (
          <Notice tone="warn">Official event dates are not yet confirmed (SDS §10 open decision).</Notice>
        )}
        <Card title="General">
          {!canEdit && <p className="mb-3 text-sm text-muted">Only the Parade Director can change these settings.</p>}
          <SettingsForm
            canEdit={canEdit}
            values={{
              id: event.id,
              timezone: event.timezone,
              name: event.name,
              host_organization: event.host_organization ?? "",
              municipality: event.municipality ?? "",
              status: event.status,
              starts_at: toLocalInput(event.starts_at, event.timezone),
              registration_opens_at: toLocalInput(event.registration_opens_at, event.timezone),
              registration_closes_at: toLocalInput(event.registration_closes_at, event.timezone),
              default_separation_ft: Number(event.default_separation_ft),
              arrival_instructions: String(s.arrival_instructions ?? ""),
              accessible_viewing: String(s.accessible_viewing ?? ""),
            }}
          />
        </Card>
        <Card title="Categories">
          <CategoryEditor eventId={event.id} categories={categories ?? []} canEdit={isDirector(access)} />
        </Card>
        <Card title="Policy">
          <ul className="space-y-1 text-sm">
            <li>Approval: {String(s.approval_policy ?? "manual")}</li>
            <li>Registration fees: {s.fees_enabled ? "enabled" : "disabled"}</li>
          </ul>
        </Card>
        {access.isSystemAdmin && (
          <Card title="Next year's event">
            <CloneEventForm eventId={event.id} name={event.name} year={event.year} />
          </Card>
        )}
      </div>
    </>
  );
}
