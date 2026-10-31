"use client";

import { useState } from "react";
import { reportIncident } from "@/lib/actions/staff";

export function IncidentForm({
  eventId,
  checkpointId,
  units,
  online,
  onDone,
}: {
  eventId: string;
  checkpointId: string | null;
  units: { id: string; name: string; sequence_number: number | null }[];
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
