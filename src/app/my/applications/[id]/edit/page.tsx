import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, type ApplicationRow, type EventRow, type VehicleRow } from "@/lib/data";
import { loadFormOptions } from "@/lib/form-options";
import { isEditableByParticipant } from "@/lib/domain/applications";
import { ApplicationForm } from "@/components/application-form";
import { Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Edit entry" };

export default async function EditApplication({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/my/applications/${id}/edit`);
  const supabase = await createClient();

  const { data: app } = await supabase
    .from("applications")
    .select("*, events(*)")
    .eq("id", id)
    .maybeSingle<ApplicationRow & { events: EventRow }>();
  if (!app) notFound();
  if (!isEditableByParticipant(app.status)) redirect(`/my/applications/${id}`);

  const [{ data: vehicles }, options] = await Promise.all([
    supabase.from("vehicles").select("*").eq("application_id", id).order("created_at").returns<VehicleRow[]>(),
    loadFormOptions(app.events, user.id),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title={`Edit: ${app.entry_name}`} subtitle={`${app.events.year} ${app.events.name}`} />
      {app.status === "needs_information" && app.status_note && (
        <div className="mb-6">
          <Notice tone="warn">{app.status_note}</Notice>
        </div>
      )}
      <ApplicationForm options={options} application={app} vehicles={vehicles ?? []} />
    </main>
  );
}
