"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveData } from "@/components/use-live-data";
import { ParadeMap } from "@/components/map";
import { IncidentForm } from "@/components/marshal/incident-form";
import type { StagingLayout } from "@/lib/domain/staging";

interface Progress {
  checkpoint_id: string;
  code: string;
  name: string;
  sequence: number;
  units_passed: number;
  units_expected: number;
  head_passed_at: string | null;
  tail_passed_at: string | null;
  all_clear: boolean;
}
interface Data {
  event: { parade_hold: boolean; parade_hold_reason: string | null; status: string };
  progress: Progress[];
  layout: StagingLayout | null;
  units: { id: string; name: string; sequence_number: number | null; status: string }[];
  incidents: { id: string; summary: string; severity: string; status: string; location_description: string | null }[];
  assignments: { position: string; notes: string | null; shift_start: string | null; checkpoints: { name: string } | null; staging_zones: { street_name: string } | null }[];
}

const WAITING = ["not_arrived", "checked_in", "staged", "ready", "authorized", "held"];
const MOVING = ["released", "on_route", "incident"];

export function TrafficApp({ eventId, timezone }: { eventId: string; timezone: string }) {
  const [supabase] = useState(createClient);
  const [reporting, setReporting] = useState(false);
  const time = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: timezone }).format(new Date(iso)) : "";

  const { data, live, updatedAt } = useLiveData<Data>(eventId, ["parade_units", "movement_events", "events", "incidents"], async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const [ev, progress, layout, units, incidents, assignments] = await Promise.all([
      supabase.from("events").select("parade_hold, parade_hold_reason, status").eq("id", eventId).single(),
      supabase.rpc("route_progress", { p_event_id: eventId }),
      supabase.rpc("staging_layout", { p_event_id: eventId }),
      supabase.from("parade_units").select("id, name, sequence_number, status").eq("event_id", eventId).neq("status", "withdrawn").order("sequence_number", { ascending: true, nullsFirst: false }),
      supabase.from("incidents").select("id, summary, severity, status, location_description").eq("event_id", eventId).in("status", ["open", "acknowledged"]).order("created_at", { ascending: false }),
      supabase.from("volunteer_assignments").select("position, notes, shift_start, checkpoints(name), staging_zones(street_name)").eq("event_id", eventId).eq("user_id", user?.id ?? ""),
    ]);
    const err = ev.error ?? progress.error ?? units.error;
    if (err) throw new Error(err.message);
    return {
      event: ev.data!,
      progress: (progress.data as Progress[]) ?? [],
      layout: (layout.data as StagingLayout) ?? null,
      units: units.data ?? [],
      incidents: incidents.data ?? [],
      assignments: (assignments.data as unknown as Data["assignments"]) ?? [],
    };
  });

  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const lineup = data.units.filter((u) => u.sequence_number !== null);
  const waiting = lineup.filter((u) => WAITING.includes(u.status)).length;
  const moving = lineup.filter((u) => MOVING.includes(u.status)).length;
  const finished = lineup.filter((u) => u.status === "finished").length;
  const head = [...data.progress].reverse().find((p) => p.units_passed > 0);
  const clearThrough = [...data.progress].reverse().find((p) => p.all_clear);
  const finish = data.progress[data.progress.length - 1];
  const zoneName = new Map<string, string>();
  const laneName = new Map<string, string>();
  const blockName = new Map<string, string>();
  for (const z of data.layout?.zones ?? []) {
    zoneName.set(z.id, z.street_name);
    for (const l of z.lanes) {
      laneName.set(l.id, `${z.street_name} lane ${l.lane_number}`);
      for (const b of l.blocks) blockName.set(b.id, `${z.street_name} lane ${l.lane_number} block ${b.block_number}`);
    }
  }
  const closures = (data.layout?.restrictions ?? []).filter((r) => r.active);

  return (
    <div className="space-y-3">
      <p className={`text-xs ${live ? "text-emerald-700" : "text-amber-800"}`}>
        {live ? "● Live" : "○ Reconnecting, refreshing every 15 s"}
        {updatedAt && ` · updated ${updatedAt.toLocaleTimeString()}`}
      </p>

      {data.event.parade_hold ? (
        <div className="rounded-xl bg-accent p-4 text-white" role="alert">
          <p className="text-2xl font-bold">PARADE HOLD</p>
          <p>{data.event.parade_hold_reason}</p>
        </div>
      ) : (
        <div className="rounded-xl border-2 border-brand bg-surface p-4">
          <p className="text-xl font-semibold">
            {finish?.all_clear ? "Parade complete: route clear" : moving > 0 ? "Parade moving" : waiting > 0 ? "Parade staging" : "Not started"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {waiting} in staging · {moving} on route · {finished} finished
          </p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-muted uppercase">Head of parade</p>
          <p className="font-semibold">{head ? head.name : "Not on route yet"}</p>
          {head && <p className="text-xs text-muted">first passed {time(head.head_passed_at)}</p>}
        </div>
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-muted uppercase">Route clear through</p>
          <p className="font-semibold">{clearThrough ? clearThrough.name : "Nothing clear yet"}</p>
          {clearThrough && <p className="text-xs text-muted">last unit passed {time(clearThrough.tail_passed_at)}</p>}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-3 py-2 text-sm font-semibold">Checkpoints</h2>
        <ol className="divide-y divide-border">
          {data.progress.map((p) => (
            <li key={p.checkpoint_id} className="flex items-center gap-3 px-3 py-3">
              <span className="w-6 font-mono text-sm text-muted">{p.sequence}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="text-xs text-muted">
                  {p.units_passed}/{p.units_expected} units passed
                </span>
              </span>
              {p.all_clear ? (
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-900">Clear {time(p.tail_passed_at)}</span>
              ) : p.units_passed > 0 ? (
                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Parade passing</span>
              ) : (
                <span className="rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-700">Not reached</span>
              )}
            </li>
          ))}
        </ol>
        <p className="border-t border-border px-3 py-2 text-xs text-muted">
          &quot;Clear&quot; means every participating unit has been reported past that checkpoint. Reopening streets is a police decision.
        </p>
      </section>

      {data.assignments.length > 0 && (
        <section className="rounded-lg border border-border bg-surface p-3 text-sm">
          <h2 className="mb-1 font-semibold">Your assignment</h2>
          {data.assignments.map((a, i) => (
            <p key={i}>
              {a.position}
              {a.checkpoints?.name && ` at ${a.checkpoints.name}`}
              {a.staging_zones?.street_name && ` at ${a.staging_zones.street_name}`}
              {a.shift_start && ` from ${time(a.shift_start)}`}
              {a.notes && <span className="block text-xs text-muted">{a.notes}</span>}
            </p>
          ))}
        </section>
      )}

      {data.incidents.length > 0 && (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">
          <h2 className="mb-1 font-semibold">Open incidents ({data.incidents.length})</h2>
          <ul className="space-y-1">
            {data.incidents.map((i) => (
              <li key={i.id}>
                <span className="font-medium uppercase">{i.severity}</span>: {i.summary}
                {i.location_description && <span className="text-muted"> · {i.location_description}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface p-3 text-sm">
        <h2 className="mb-1 font-semibold">Road closures &amp; restrictions ({closures.length})</h2>
        {closures.length === 0 ? (
          <p className="text-muted">None active.</p>
        ) : (
          <ul className="space-y-1">
            {closures.map((r) => (
              <li key={r.id}>
                <span className="font-medium">{blockName.get(r.block_id ?? "") ?? laneName.get(r.lane_id ?? "") ?? zoneName.get(r.zone_id ?? "")}</span>
                : {r.status.replace(/_/g, " ")}, {r.reason}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.layout && <ParadeMap layout={data.layout} fit="all" className="h-80" />}

      <button className="w-full rounded-lg border border-accent py-3 font-medium text-accent" onClick={() => setReporting((v) => !v)}>
        {reporting ? "Cancel incident report" : "Report an incident"}
      </button>
      {reporting && (
        <IncidentForm eventId={eventId} checkpointId={null} units={data.units} online onDone={() => setReporting(false)} />
      )}
    </div>
  );
}
