"use client";

import { useState } from "react";
import { Badge, Card, EmptyState, Notice, buttonClass } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { formatDateTime } from "@/lib/format";
import { endRestriction, reportIncident, updateIncident } from "@/lib/actions/staff";
import { RestrictionForm } from "../staging/staging-workspace";

export interface Incident {
  id: string;
  summary: string;
  details: string | null;
  severity: "low" | "moderate" | "high" | "critical";
  status: "open" | "acknowledged" | "resolved" | "closed";
  resolution: string | null;
  created_at: string;
  location_description: string | null;
  parade_units: { name: string } | null;
  checkpoints: { name: string } | null;
  profiles: { full_name: string | null; email: string | null } | null;
}
export interface Restriction {
  id: string;
  status: string;
  reason: string;
  is_safety: boolean;
  responsible_authority: string;
  effective_from: string;
  effective_to: string | null;
  target: string;
}
export interface Target {
  kind: "zone" | "lane" | "block";
  id: string;
  label: string;
}

const SEVERITY_TONE = { low: "neutral", moderate: "warn", high: "bad", critical: "bad" } as const;

export function SafetyConsole({
  eventId,
  timezone,
  canManage,
  incidents,
  restrictions,
  targets,
  units,
  checkpoints,
}: {
  eventId: string;
  timezone: string;
  canManage: boolean;
  incidents: Incident[];
  restrictions: Restriction[];
  targets: Target[];
  units: { id: string; name: string; sequence_number: number | null }[];
  checkpoints: { id: string; name: string }[];
}) {
  const action = useAction();
  const [form, setForm] = useState({ summary: "", details: "", severity: "moderate", unit_id: "", checkpoint_id: "", location_description: "" });
  const [targetId, setTargetId] = useState("");
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const now = Date.now();
  const active = restrictions.filter((r) => new Date(r.effective_from).getTime() <= now && (!r.effective_to || new Date(r.effective_to).getTime() > now));
  const inactive = restrictions.filter((r) => !active.includes(r));
  const open = incidents.filter((i) => i.status === "open" || i.status === "acknowledged");
  const target = targets.find((t) => t.id === targetId);

  return (
    <div className="space-y-6">
      {action.error && <Notice tone="bad">{action.error}</Notice>}
      {action.message && <Notice tone="good">{action.message}</Notice>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`Open incidents (${open.length})`}>
          {incidents.length === 0 ? (
            <EmptyState>No incidents reported.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {incidents.map((i) => (
                <li key={i.id} className={`rounded-md border p-3 text-sm ${i.status === "open" ? "border-rose-300" : "border-border"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY_TONE[i.severity]}>{i.severity}</Badge>
                    <span className="font-medium">{i.summary}</span>
                    <span className="ml-auto text-xs text-muted">{i.status}</span>
                  </div>
                  {i.details && <p className="mt-1">{i.details}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {formatDateTime(i.created_at, timezone)} · {i.profiles?.full_name || i.profiles?.email}
                    {i.parade_units && ` · ${i.parade_units.name}`}
                    {i.checkpoints && ` · at ${i.checkpoints.name}`}
                    {i.location_description && ` · ${i.location_description}`}
                  </p>
                  {i.resolution && <p className="mt-1 text-xs">Resolution: {i.resolution}</p>}
                  {canManage && i.status !== "closed" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {i.status === "open" && (
                        <button className={buttonClass("secondary")} disabled={action.pending} onClick={() => action.run(() => updateIncident(i.id, "acknowledged", i.resolution ?? ""), "Acknowledged.")}>
                          Acknowledge
                        </button>
                      )}
                      <input className="input max-w-xs py-1 text-xs" placeholder="Resolution" value={resolution[i.id] ?? ""} onChange={(e) => setResolution({ ...resolution, [i.id]: e.target.value })} />
                      <button className={buttonClass("secondary")} disabled={action.pending || !resolution[i.id]?.trim()} onClick={() => action.run(() => updateIncident(i.id, "resolved", resolution[i.id]), "Incident resolved.")}>
                        Resolve
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Report an incident">
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await action.run(
                () => reportIncident({ event_id: eventId, ...form, unit_id: form.unit_id || null, checkpoint_id: form.checkpoint_id || null }),
                "Incident reported. Leadership has been notified.",
              );
              if (ok) setForm({ summary: "", details: "", severity: "moderate", unit_id: "", checkpoint_id: "", location_description: "" });
            }}
          >
            <input className="input" required placeholder="Summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
            <div className="grid gap-2 sm:grid-cols-3">
              <select className="input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} aria-label="Severity">
                {["low", "moderate", "high", "critical"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <select className="input" value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })} aria-label="Unit">
                <option value="">No unit</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.sequence_number ? `#${u.sequence_number} ` : ""}
                    {u.name}
                  </option>
                ))}
              </select>
              <select className="input" value={form.checkpoint_id} onChange={(e) => setForm({ ...form, checkpoint_id: e.target.value })} aria-label="Checkpoint">
                <option value="">No checkpoint</option>
                {checkpoints.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <input className="input" placeholder="Location (cross streets, landmark)" value={form.location_description} onChange={(e) => setForm({ ...form, location_description: e.target.value })} />
            <textarea className="input" rows={3} placeholder="Details" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} />
            <button className={buttonClass("danger")} disabled={action.pending}>
              Report incident
            </button>
          </form>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`Active restrictions (${active.length})`}>
          {active.length === 0 ? (
            <EmptyState>No active restrictions.</EmptyState>
          ) : (
            <ul className="space-y-2 text-sm">
              {active.map((r) => (
                <RestrictionRow key={r.id} r={r} timezone={timezone} canManage={canManage} onEnd={() => action.run(() => endRestriction(r.id), "Restriction ended. Flagged placements stay flagged until the director re-approves them.")} />
              ))}
            </ul>
          )}
          {inactive.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-muted">Ended or scheduled ({inactive.length})</summary>
              <ul className="mt-2 space-y-2">
                {inactive.map((r) => (
                  <RestrictionRow key={r.id} r={r} timezone={timezone} canManage={false} />
                ))}
              </ul>
            </details>
          )}
        </Card>

        {canManage && (
          <Card title="Add a restriction">
            <select className="input mb-2" value={targetId} onChange={(e) => setTargetId(e.target.value)} aria-label="Affected area">
              <option value="">Choose the affected street, lane or block…</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {target && <RestrictionForm key={target.id} eventId={eventId} target={target.kind} targetId={target.id} action={action} onDone={() => setTargetId("")} />}
          </Card>
        )}
      </div>
    </div>
  );
}

function RestrictionRow({ r, timezone, canManage, onEnd }: { r: Restriction; timezone: string; canManage: boolean; onEnd?: () => void }) {
  return (
    <li className="rounded-md border border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={r.status === "restricted" ? "warn" : "bad"}>{r.status.replace(/_/g, " ")}</Badge>
        {r.is_safety && <Badge tone="bad">safety</Badge>}
        <span className="font-medium">{r.target}</span>
      </div>
      <p className="mt-1">{r.reason}</p>
      <p className="text-xs text-muted">
        {r.responsible_authority} · from {formatDateTime(r.effective_from, timezone)}
        {r.effective_to ? ` until ${formatDateTime(r.effective_to, timezone)}` : " · no end date"}
      </p>
      {canManage && onEnd && (
        <button className="mt-1 text-xs text-brand hover:underline" onClick={onEnd}>
          End now
        </button>
      )}
    </li>
  );
}
