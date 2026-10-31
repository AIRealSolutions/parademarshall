"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveData } from "@/components/use-live-data";
import { useOfflineQueue } from "@/components/marshal/use-offline-queue";
import { ConnectionBar, QueueList } from "@/components/marshal/sync-badge";
import { reportIncident } from "@/lib/actions/staff";

interface Data {
  checkpoints: { id: string; code: string; name: string; sequence: number }[];
  units: { id: string; name: string; sequence_number: number | null; status: string }[];
  passed: { unit_id: string; checkpoint_id: string }[];
}

const ON_ROUTE = ["authorized", "released", "on_route", "incident"];

export function CheckpointApp({ eventId }: { eventId: string }) {
  const [supabase] = useState(createClient);
  const [checkpointId, setCheckpointId] = useState<string>("");
  const [showAll, setShowAll] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);

  useEffect(() => {
    try {
      setCheckpointId(localStorage.getItem(`checkpoint:${eventId}`) ?? "");
    } catch {}
  }, [eventId]);
  const chooseCheckpoint = (id: string) => {
    setCheckpointId(id);
    try {
      localStorage.setItem(`checkpoint:${eventId}`, id);
    } catch {}
  };

  const { data, refresh } = useLiveData<Data>(eventId, ["parade_units", "movement_events"], async () => {
    const [cps, units, passed] = await Promise.all([
      supabase.from("checkpoints").select("id, code, name, sequence").eq("event_id", eventId).order("sequence"),
      supabase
        .from("parade_units")
        .select("id, name, sequence_number, status")
        .eq("event_id", eventId)
        .not("status", "in", "(withdrawn)")
        .order("sequence_number", { ascending: true, nullsFirst: false }),
      supabase.from("movement_events").select("unit_id, checkpoint_id").eq("event_id", eventId),
    ]);
    const err = cps.error ?? units.error ?? passed.error;
    if (err) throw new Error(err.message);
    return { checkpoints: cps.data ?? [], units: units.data ?? [], passed: passed.data ?? [] };
  });
  const { queue, online, enqueue, dismiss, pending } = useOfflineQueue(eventId, refresh);

  const recorded = useMemo(() => {
    const s = new Set<string>();
    data?.passed.filter((p) => p.checkpoint_id === checkpointId).forEach((p) => s.add(p.unit_id));
    queue
      .filter((a) => a.kind === "checkpoint_pass" && a.args.p_checkpoint_id === checkpointId && a.state !== "rejected")
      .forEach((a) => s.add(a.args.p_unit_id as string));
    return s;
  }, [data, queue, checkpointId]);

  const checkpoint = data?.checkpoints.find((c) => c.id === checkpointId);
  const expected = (data?.units ?? []).filter((u) => !recorded.has(u.id) && (showAll || ON_ROUTE.includes(u.status)));

  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  if (!checkpoint) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Which checkpoint are you at?</h1>
        {data.checkpoints.map((c) => (
          <button key={c.id} className="block w-full rounded-xl border border-border bg-surface p-4 text-left text-lg font-medium active:bg-stone-100" onClick={() => chooseCheckpoint(c.id)}>
            {c.sequence}. {c.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ConnectionBar online={online} pending={pending} />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{checkpoint.name}</h1>
        <button className="text-sm text-muted underline" onClick={() => chooseCheckpoint("")}>
          Change
        </button>
      </div>

      <ul className="space-y-2">
        {expected.map((u) => (
          <li key={u.id}>
            <button
              className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 text-left active:bg-emerald-50"
              onClick={() => enqueue("checkpoint_pass", `${u.name} passed ${checkpoint.name}`, { p_unit_id: u.id, p_checkpoint_id: checkpoint.id, p_notes: null })}
            >
              <span className="w-10 font-mono text-lg text-muted">{u.sequence_number ?? "—"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-medium">{u.name}</span>
                <span className="text-xs text-muted">{u.status.replace(/_/g, " ")}</span>
              </span>
              <span className="rounded-lg bg-brand px-3 py-2 font-semibold text-white">Passed</span>
            </button>
          </li>
        ))}
        {expected.length === 0 && (
          <li className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">
            No units expected yet. Units appear here once dispatch releases them.
          </li>
        )}
      </ul>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        Show units not yet released (reports are escalated to dispatch)
      </label>

      <button className="w-full rounded-lg border border-accent py-3 font-medium text-accent" onClick={() => setIncidentOpen((v) => !v)}>
        {incidentOpen ? "Cancel incident report" : "Report an incident"}
      </button>
      {incidentOpen && (
        <IncidentForm
          eventId={eventId}
          checkpointId={checkpoint.id}
          units={data.units}
          online={online}
          onDone={() => setIncidentOpen(false)}
        />
      )}

      <QueueList queue={queue} onDismiss={dismiss} />
    </div>
  );
}

function IncidentForm({
  eventId,
  checkpointId,
  units,
  online,
  onDone,
}: {
  eventId: string;
  checkpointId: string;
  units: Data["units"];
  online: boolean;
  onDone: () => void;
}) {
  const [v, setV] = useState({ summary: "", severity: "moderate", unit_id: "", details: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await reportIncident({
          event_id: eventId,
          summary: v.summary,
          details: v.details,
          severity: v.severity,
          unit_id: v.unit_id || null,
          checkpoint_id: checkpointId,
          location_description: "",
        });
        setBusy(false);
        if (r.error) setError(r.error);
        else onDone();
      }}
    >
      <p className="text-xs">For emergencies, call 911 first. This report notifies parade leadership.</p>
      <input className="input" required placeholder="What happened?" value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} />
      <select className="input" value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })} aria-label="Severity">
        <option value="low">Low</option>
        <option value="moderate">Moderate</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
      <select className="input" value={v.unit_id} onChange={(e) => setV({ ...v, unit_id: e.target.value })} aria-label="Unit involved">
        <option value="">No specific unit</option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.sequence_number ? `#${u.sequence_number} ` : ""}
            {u.name}
          </option>
        ))}
      </select>
      <textarea className="input" rows={2} placeholder="Details" value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} />
      {!online && <p className="text-xs text-accent">You are offline. Incident reports need a connection; use your radio.</p>}
      {error && <p className="text-xs text-accent">{error}</p>}
      <button className="w-full rounded-lg bg-accent py-3 font-semibold text-white" disabled={busy || !online}>
        Send report
      </button>
    </form>
  );
}
