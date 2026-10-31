import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { passUrl } from "@/lib/pass";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";
import { requireUser, type ApplicationRow, type VehicleRow } from "@/lib/data";
import { feet, formatDateTime } from "@/lib/format";
import { isEditableByParticipant } from "@/lib/domain/applications";
import { ButtonLink, Card, DefinitionList, Notice, PageHeader, StatusBadge, buttonClass } from "@/components/ui";
import { TransitionButton } from "@/components/transition-button";

export const metadata: Metadata = { title: "Entry" };

const PASS_STATUSES = ["approved", "assigned", "checked_in"];

export default async function MyApplication({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  await requireUser(`/my/applications/${id}`);
  const supabase = await createClient();

  const { data: app } = await supabase
    .from("applications")
    .select("*, events(name, year, slug, timezone), organizations(name), parade_categories(name)")
    .eq("id", id)
    .maybeSingle<ApplicationRow & {
      events: { name: string; year: number; slug: string; timezone: string };
      organizations: { name: string };
      parade_categories: { name: string } | null;
    }>();
  if (!app) notFound();

  const [{ data: vehicles }, { data: units }] = await Promise.all([
    supabase.from("vehicles").select("*").eq("application_id", id).order("created_at").returns<VehicleRow[]>(),
    supabase
      .from("parade_units")
      .select("id, name, pass_token, sequence_number, status, staging_assignments(status, start_offset_ft, staging_blocks(block_number, staging_lanes(lane_number, staging_zones(street_name))))")
      .eq("application_id", id),
  ]);

  const showPass = PASS_STATUSES.includes(app.status);
  const origin = await siteOrigin();
  const passes = showPass
    ? await Promise.all(
        (units ?? []).map(async (u) => ({
          ...u,
          svg: await QRCode.toString(passUrl(u.pass_token, origin), { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
        })),
      )
    : [];
  const editable = isEditableByParticipant(app.status);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <p className="text-sm">
        <Link href="/my" className="text-brand hover:underline">
          ← My entries
        </Link>
      </p>
      <PageHeader
        title={app.entry_name}
        subtitle={`${app.organizations.name} · ${app.events.year} ${app.events.name}`}
        actions={<StatusBadge status={app.status} />}
      />

      {saved === "draft" && <Notice tone="good">Draft saved. Submit it when you&apos;re ready.</Notice>}
      {saved === "submit" && (
        <Notice tone="good">Submitted. The parade committee will review your entry and email you.</Notice>
      )}
      {app.status === "needs_information" && app.status_note && (
        <Notice tone="warn">
          <p className="font-semibold">The committee needs more information</p>
          <p className="mt-1 whitespace-pre-line">{app.status_note}</p>
        </Notice>
      )}
      {app.status === "rejected" && app.status_note && <Notice tone="bad">{app.status_note}</Notice>}

      {(editable || app.status !== "withdrawn") && (
        <div className="flex flex-wrap gap-3">
          {editable && <ButtonLink href={`/my/applications/${id}/edit`}>Edit entry</ButtonLink>}
          {editable && <TransitionButton applicationId={id} to="submitted" label="Submit for review" variant="primary" />}
          {["draft", "submitted", "under_review", "needs_information", "approved", "waitlisted", "assigned"].includes(
            app.status,
          ) && (
            <TransitionButton
              applicationId={id}
              to="withdrawn"
              label="Withdraw entry"
              variant="danger"
              confirm="Withdraw this entry from the parade? This cannot be undone."
            />
          )}
        </div>
      )}

      {passes.length > 0 && (
        <Card title="Parade-day pass">
          <p className="mb-4 text-sm text-muted">
            Show this code to a staging marshal when you arrive. It identifies your unit only and contains no
            personal information. Open the pass for a printable copy, a full-page dashboard sign for your windshield,
            and live status on parade night.
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            {passes.map((u) => {
              const a = (u.staging_assignments as unknown as {
                status: string;
                staging_blocks: { block_number: number; staging_lanes: { lane_number: number; staging_zones: { street_name: string } } };
              }[])?.find((s) => s.status === "approved");
              return (
                <div key={u.id} className="rounded-md border border-border p-4 text-center">
                  <div className="mx-auto w-48" dangerouslySetInnerHTML={{ __html: u.svg }} />
                  <p className="mt-2 font-semibold">{u.name}</p>
                  {u.sequence_number && <p className="text-sm text-muted">Lineup position {u.sequence_number}</p>}
                  {a && app.status !== "approved" && (
                    <p className="mt-2 text-sm">
                      Report to <strong>{a.staging_blocks.staging_lanes.staging_zones.street_name}</strong>, lane{" "}
                      {a.staging_blocks.staging_lanes.lane_number}, block {a.staging_blocks.block_number}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <Link href={`/pass/${u.pass_token}`} className={buttonClass()}>
                      Open pass
                    </Link>
                    <Link href={`/pass/${u.pass_token}/sign`} className={buttonClass("secondary")}>
                      Dashboard sign
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
          {app.status === "approved" && (
            <p className="mt-4 text-sm text-muted">Your staging location and arrival time will be sent once assigned.</p>
          )}
        </Card>
      )}

      <Card title="Entry details">
        <DefinitionList
          items={[
            ["Category", app.parade_categories?.name],
            ["Participants", app.participant_count],
            ["Purpose", app.purpose],
            ["Responsible contact", `${app.responsible_contact_name} · ${app.responsible_contact_phone} · ${app.responsible_contact_email}`],
            ["Overall footprint", `${feet(app.footprint_length_ft)} long × ${feet(app.footprint_width_ft)} wide`],
            ["Animals / amplified sound", `${app.has_animals ? "Yes" : "No"} / ${app.has_amplified_sound ? "Yes" : "No"}`],
            ["Safety requirements", app.safety_requirements],
            ["Accessibility needs", app.accessibility_needs],
            ["Public name", app.public_name],
            ["Public description", app.public_description],
            ["Submitted", formatDateTime(app.submitted_at, app.events.timezone)],
            ["Acknowledgment", app.waiver_accepted_at ? `Accepted by ${app.waiver_accepted_name}` : "Not yet accepted"],
          ]}
        />
      </Card>

      <Card title="Vehicles">
        {vehicles && vehicles.length > 0 ? (
          <ul className="divide-y divide-border text-sm">
            {vehicles.map((v) => (
              <li key={v.id} className="py-2">
                <span className="font-medium">{v.vehicle_type}</span> · {feet(v.length_ft)}
                {v.is_towing && ` + ${feet(v.trailer_length_ft)} trailer`}
                {v.driver_name && ` · driver ${v.driver_name}`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No vehicles listed.</p>
        )}
      </Card>
    </main>
  );
}
