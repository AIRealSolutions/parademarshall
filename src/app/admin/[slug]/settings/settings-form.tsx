"use client";

import { useActionState } from "react";
import { Field, Notice, buttonClass } from "@/components/ui";
import { updateEventSettings, type SettingsState } from "./actions";

export interface SettingsValues {
  id: string;
  timezone: string;
  name: string;
  host_organization: string;
  municipality: string;
  status: string;
  starts_at: string;
  registration_opens_at: string;
  registration_closes_at: string;
  default_separation_ft: number;
}

const STATUS_OPTIONS: [string, string][] = [
  ["draft", "Draft (hidden from public)"],
  ["registration_open", "Registration open"],
  ["registration_closed", "Registration closed"],
  ["operational", "Operational planning"],
  ["live", "Live (parade day)"],
  ["completed", "Completed"],
  ["archived", "Archived"],
];

export function SettingsForm({ values, canEdit }: { values: SettingsValues; canEdit: boolean }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateEventSettings, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="event_id" value={values.id} />
      <input type="hidden" name="timezone" value={values.timezone} />
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Event name" htmlFor="name" required>
          <input id="name" name="name" defaultValue={values.name} className="input" />
        </Field>
        <Field label="Status" htmlFor="status">
          <select id="status" name="status" defaultValue={values.status} className="input">
            {STATUS_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Host organization" htmlFor="host_organization" hint="City, fire department or parade committee — open decision.">
          <input id="host_organization" name="host_organization" defaultValue={values.host_organization} className="input" />
        </Field>
        <Field label="Municipality" htmlFor="municipality">
          <input id="municipality" name="municipality" defaultValue={values.municipality} className="input" />
        </Field>
        <Field label="Parade start" htmlFor="starts_at" hint={`Time zone: ${values.timezone}`}>
          <input id="starts_at" name="starts_at" type="datetime-local" defaultValue={values.starts_at} className="input" />
        </Field>
        <Field label="Default separation (ft)" htmlFor="default_separation_ft" hint="Added to each unit footprint when approved.">
          <input id="default_separation_ft" name="default_separation_ft" type="number" min={0} step="1"
            defaultValue={values.default_separation_ft} className="input" />
        </Field>
        <Field label="Registration opens" htmlFor="registration_opens_at">
          <input id="registration_opens_at" name="registration_opens_at" type="datetime-local"
            defaultValue={values.registration_opens_at} className="input" />
        </Field>
        <Field label="Registration closes" htmlFor="registration_closes_at">
          <input id="registration_closes_at" name="registration_closes_at" type="datetime-local"
            defaultValue={values.registration_closes_at} className="input" />
        </Field>
      </fieldset>
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      {state.ok && <Notice tone="good">Settings saved.</Notice>}
      {canEdit && (
        <button className={buttonClass()} disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </button>
      )}
    </form>
  );
}
