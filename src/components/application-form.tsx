"use client";

import { useActionState, useId, useMemo, useRef, useState } from "react";
import { Field, Notice, buttonClass } from "@/components/ui";
import { computeFootprint } from "@/lib/domain/footprint";
import { saveApplication, type SaveState } from "@/app/my/actions/save-application";
import type { ApplicationRow, VehicleRow } from "@/lib/data";

export interface FormOptions {
  eventId: string;
  separationFt: number;
  categories: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  waiver: { id: string; title: string; body: string } | null;
}

interface VehicleDraft {
  key: number;
  vehicle_type: string;
  description: string;
  length_ft: string;
  width_ft: string;
  height_ft: string;
  is_towing: boolean;
  trailer_length_ft: string;
  driver_name: string;
}

const blankVehicle = (key: number): VehicleDraft => ({
  key,
  vehicle_type: "",
  description: "",
  length_ft: "",
  width_ft: "",
  height_ft: "",
  is_towing: false,
  trailer_length_ft: "0",
  driver_name: "",
});

const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function ApplicationForm({
  options,
  application,
  vehicles: initialVehicles = [],
}: {
  options: FormOptions;
  application?: ApplicationRow;
  vehicles?: VehicleRow[];
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveApplication, {});
  const e = state.errors ?? {};
  const [orgChoice, setOrgChoice] = useState(
    application?.organization_id ?? options.organizations[0]?.id ?? "new",
  );
  const [declaredLength, setDeclaredLength] = useState(String(application?.footprint_length_ft ?? ""));
  // Keys must be deterministic so server and client render the same element ids.
  const uid = useId();
  const nextKey = useRef(initialVehicles.length);
  const [vehicles, setVehicles] = useState<VehicleDraft[]>(
    initialVehicles.map((v, i) => ({
      key: i,
      vehicle_type: v.vehicle_type,
      description: v.description ?? "",
      length_ft: String(v.length_ft),
      width_ft: v.width_ft ? String(v.width_ft) : "",
      height_ft: v.height_ft ? String(v.height_ft) : "",
      is_towing: v.is_towing,
      trailer_length_ft: String(v.trailer_length_ft ?? 0),
      driver_name: v.driver_name ?? "",
    })),
  );

  const footprint = useMemo(
    () =>
      computeFootprint(
        Number(declaredLength) || 0,
        vehicles.map((v) => ({ length_ft: Number(v.length_ft) || 0, trailer_length_ft: Number(v.trailer_length_ft) || 0 })),
        options.separationFt,
      ),
    [declaredLength, vehicles, options.separationFt],
  );

  const vehiclesJson = JSON.stringify(
    vehicles.map((v) => ({
      vehicle_type: v.vehicle_type,
      description: v.description || undefined,
      length_ft: num(v.length_ft),
      width_ft: num(v.width_ft),
      height_ft: num(v.height_ft),
      is_towing: v.is_towing,
      trailer_length_ft: num(v.trailer_length_ft) ?? 0,
      driver_name: v.driver_name || undefined,
    })),
  );

  const update = (key: number, patch: Partial<VehicleDraft>) =>
    setVehicles((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const waiverAlreadyAccepted =
    !!application?.waiver_accepted_at && application.waiver_id === options.waiver?.id;

  return (
    <form action={action} className="space-y-8" noValidate>
      <input type="hidden" name="event_id" value={options.eventId} />
      <input type="hidden" name="application_id" value={application?.id ?? ""} />
      <input type="hidden" name="vehicles" value={vehiclesJson} />

      <Section title="Organization" description="Who is responsible for this entry? Organizations can submit several entries.">
        {options.organizations.length > 0 && (
          <Field label="Organization" htmlFor="organization_id" required>
            <select
              id="organization_id"
              name="organization_id"
              className="input"
              value={orgChoice}
              onChange={(ev) => setOrgChoice(ev.target.value)}
            >
              {options.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
              <option value="new">+ Add a new organization</option>
            </select>
          </Field>
        )}
        {(orgChoice === "new" || options.organizations.length === 0) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {options.organizations.length === 0 && <input type="hidden" name="organization_id" value="new" />}
            <Field label="Organization name" htmlFor="org_name" required error={e.org_name}>
              <input id="org_name" name="org_name" className="input" autoComplete="organization" />
            </Field>
            <Field label="Organization contact" htmlFor="org_contact_name" error={e.org_contact_name}>
              <input id="org_contact_name" name="org_contact_name" className="input" />
            </Field>
            <Field label="Organization email" htmlFor="org_contact_email" error={e.org_contact_email}>
              <input id="org_contact_email" name="org_contact_email" type="email" className="input" />
            </Field>
            <Field label="Organization phone" htmlFor="org_contact_phone" error={e.org_contact_phone}>
              <input id="org_contact_phone" name="org_contact_phone" type="tel" className="input" />
            </Field>
            <Field label="Mailing address" htmlFor="org_mailing_address" error={e.org_mailing_address}>
              <input id="org_mailing_address" name="org_mailing_address" className="input" />
            </Field>
            <Field label="Website" htmlFor="org_website" error={e.org_website}>
              <input id="org_website" name="org_website" className="input" />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Entry">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Parade entry name" htmlFor="entry_name" required error={e.entry_name}>
            <input id="entry_name" name="entry_name" className="input" defaultValue={application?.entry_name} />
          </Field>
          <Field label="Category" htmlFor="category_id" required error={e.category_id}>
            <select id="category_id" name="category_id" className="input" defaultValue={application?.category_id ?? ""}>
              <option value="">Choose a category…</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Number of participants" htmlFor="participant_count" error={e.participant_count}
            hint="Everyone walking, riding or performing.">
            <input id="participant_count" name="participant_count" type="number" min={0} inputMode="numeric"
              className="input" defaultValue={application?.participant_count ?? 0} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Purpose of the entry" htmlFor="purpose" error={e.purpose}>
              <textarea id="purpose" name="purpose" rows={3} className="input" defaultValue={application?.purpose ?? ""} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Responsible contact" description="The person staff will call on parade day.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" htmlFor="responsible_contact_name" required error={e.responsible_contact_name}>
            <input id="responsible_contact_name" name="responsible_contact_name" className="input" autoComplete="name"
              defaultValue={application?.responsible_contact_name} />
          </Field>
          <Field label="Mobile phone" htmlFor="responsible_contact_phone" required error={e.responsible_contact_phone}>
            <input id="responsible_contact_phone" name="responsible_contact_phone" type="tel" className="input"
              autoComplete="tel" defaultValue={application?.responsible_contact_phone} />
          </Field>
          <Field label="Email" htmlFor="responsible_contact_email" required error={e.responsible_contact_email}>
            <input id="responsible_contact_email" name="responsible_contact_email" type="email" className="input"
              autoComplete="email" defaultValue={application?.responsible_contact_email} />
          </Field>
        </div>
      </Section>

      <Section title="Vehicles" description="List every vehicle, including towing vehicles and trailers. Staging space is reserved from these measurements.">
        <div className="space-y-4">
          {vehicles.length === 0 && <p className="text-sm text-muted">No vehicles — walking units can skip this.</p>}
          {vehicles.map((v, i) => (
            <fieldset key={v.key} className="rounded-md border border-border p-4">
              <legend className="px-1 text-sm font-medium">Vehicle {i + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Type" htmlFor={`${uid}-vt-${v.key}`} required error={e[`vehicles.${i}.vehicle_type`]}>
                  <input id={`${uid}-vt-${v.key}`} className="input" placeholder="Pickup, fire engine, golf cart…"
                    value={v.vehicle_type} onChange={(ev) => update(v.key, { vehicle_type: ev.target.value })} />
                </Field>
                <Field label="Length (ft)" htmlFor={`${uid}-vl-${v.key}`} required error={e[`vehicles.${i}.length_ft`]}>
                  <input id={`${uid}-vl-${v.key}`} className="input" type="number" min={0} step="0.5" inputMode="decimal"
                    value={v.length_ft} onChange={(ev) => update(v.key, { length_ft: ev.target.value })} />
                </Field>
                <Field label="Width (ft)" htmlFor={`${uid}-vw-${v.key}`} error={e[`vehicles.${i}.width_ft`]}>
                  <input id={`${uid}-vw-${v.key}`} className="input" type="number" min={0} step="0.5" inputMode="decimal"
                    value={v.width_ft} onChange={(ev) => update(v.key, { width_ft: ev.target.value })} />
                </Field>
                <Field label="Height (ft)" htmlFor={`${uid}-vh-${v.key}`} error={e[`vehicles.${i}.height_ft`]}>
                  <input id={`${uid}-vh-${v.key}`} className="input" type="number" min={0} step="0.5" inputMode="decimal"
                    value={v.height_ft} onChange={(ev) => update(v.key, { height_ft: ev.target.value })} />
                </Field>
                <div className="flex items-end gap-2 pb-2 sm:col-span-1">
                  <input id={`${uid}-vtow-${v.key}`} type="checkbox" className="h-5 w-5" checked={v.is_towing}
                    onChange={(ev) => update(v.key, { is_towing: ev.target.checked, trailer_length_ft: ev.target.checked ? v.trailer_length_ft : "0" })} />
                  <label htmlFor={`${uid}-vtow-${v.key}`} className="text-sm">Tows a trailer or float</label>
                </div>
                {v.is_towing && (
                  <Field label="Trailer length (ft)" htmlFor={`${uid}-vtl-${v.key}`} error={e[`vehicles.${i}.trailer_length_ft`]}>
                    <input id={`${uid}-vtl-${v.key}`} className="input" type="number" min={0} step="0.5" inputMode="decimal"
                      value={v.trailer_length_ft} onChange={(ev) => update(v.key, { trailer_length_ft: ev.target.value })} />
                  </Field>
                )}
                <Field label="Driver" htmlFor={`${uid}-vd-${v.key}`}>
                  <input id={`${uid}-vd-${v.key}`} className="input" value={v.driver_name}
                    onChange={(ev) => update(v.key, { driver_name: ev.target.value })} />
                </Field>
                <div className="flex items-end">
                  <button type="button" className="text-sm text-accent hover:underline"
                    onClick={() => setVehicles((vs) => vs.filter((x) => x.key !== v.key))}>
                    Remove vehicle
                  </button>
                </div>
              </div>
            </fieldset>
          ))}
          <button type="button" className={buttonClass("secondary")} onClick={() => setVehicles((vs) => [...vs, blankVehicle(nextKey.current++)])}>
            + Add vehicle
          </button>
        </div>
      </Section>

      <Section title="Unit footprint" description="The total space your whole unit occupies in line, front to back, including walkers, banners and animals.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Overall length (ft)" htmlFor="footprint_length_ft" error={e.footprint_length_ft}>
            <input id="footprint_length_ft" name="footprint_length_ft" type="number" min={0} step="1" inputMode="decimal"
              className="input" value={declaredLength} onChange={(ev) => setDeclaredLength(ev.target.value)} />
          </Field>
          <Field label="Widest point (ft)" htmlFor="footprint_width_ft" error={e.footprint_width_ft}>
            <input id="footprint_width_ft" name="footprint_width_ft" type="number" min={0} step="0.5" inputMode="decimal"
              className="input" defaultValue={application?.footprint_width_ft ?? ""} />
          </Field>
        </div>
        <p className="mt-3 rounded-md bg-stone-50 p-3 text-sm" aria-live="polite">
          Vehicles total <strong>{footprint.vehicleLengthFt} ft</strong>. Staging will reserve about{" "}
          <strong>{footprint.requiredStagingLengthFt} ft</strong> ({footprint.unitLengthFt} ft unit +{" "}
          {options.separationFt} ft separation).
        </p>
      </Section>

      <Section title="Safety & accessibility">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="has_animals" className="h-5 w-5" defaultChecked={application?.has_animals} />
              Animals in the unit
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="has_amplified_sound" className="h-5 w-5" defaultChecked={application?.has_amplified_sound} />
              Amplified sound or music
            </label>
          </div>
          <Field label="Safety requirements" htmlFor="safety_requirements" hint="Fuel, generators, open flame, turning radius, spotters…" error={e.safety_requirements}>
            <textarea id="safety_requirements" name="safety_requirements" rows={3} className="input"
              defaultValue={application?.safety_requirements ?? ""} />
          </Field>
          <Field label="Accessibility needs" htmlFor="accessibility_needs" hint="Mobility devices, seating, accessible staging location…" error={e.accessibility_needs}>
            <textarea id="accessibility_needs" name="accessibility_needs" rows={2} className="input"
              defaultValue={application?.accessibility_needs ?? ""} />
          </Field>
        </div>
      </Section>

      <Section title="Public profile" description="Optional. Shown to spectators in the published lineup once your entry is approved.">
        <div className="grid gap-4">
          <Field label="Public name" htmlFor="public_name" hint="Defaults to the entry name." error={e.public_name}>
            <input id="public_name" name="public_name" className="input" defaultValue={application?.public_name ?? ""} />
          </Field>
          <Field label="Description for spectators" htmlFor="public_description" error={e.public_description}>
            <textarea id="public_description" name="public_description" rows={3} className="input"
              defaultValue={application?.public_description ?? ""} />
          </Field>
        </div>
      </Section>

      {options.waiver && (
        <Section title={options.waiver.title}>
          <input type="hidden" name="waiver_id" value={options.waiver.id} />
          <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-stone-50 p-3 text-sm whitespace-pre-line">
            {options.waiver.body}
          </div>
          {waiverAlreadyAccepted ? (
            <p className="mt-3 text-sm text-muted">Accepted by {application?.waiver_accepted_name}.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="waiver_accepted" className="h-5 w-5" />
                I have read and accept this acknowledgment on behalf of my organization.
              </label>
              <Field label="Type your full name" htmlFor="waiver_accepted_name" error={e.waiver_accepted}>
                <input id="waiver_accepted_name" name="waiver_accepted_name" className="input" autoComplete="name" />
              </Field>
            </div>
          )}
          {waiverAlreadyAccepted && (
            <>
              <input type="hidden" name="waiver_accepted" value="on" />
              <input type="hidden" name="waiver_accepted_name" value={application?.waiver_accepted_name ?? ""} />
            </>
          )}
        </Section>
      )}

      {state.message && <Notice tone="bad">{state.message}</Notice>}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <button name="intent" value="submit" className={buttonClass()} disabled={pending}>
          {pending ? "Saving…" : "Submit for review"}
        </button>
        <button name="intent" value="draft" className={buttonClass("secondary")} disabled={pending}>
          Save draft
        </button>
      </div>
    </form>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 mb-4 text-sm text-muted">{description}</p>}
      {!description && <div className="mb-4" />}
      {children}
    </section>
  );
}
