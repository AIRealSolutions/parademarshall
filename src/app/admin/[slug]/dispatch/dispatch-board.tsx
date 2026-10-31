"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveData } from "@/components/use-live-data";
import { Badge, Notice, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

interface Unit {
  id: string;
  name: string;
  sequence_number: number | null;
  status: string;
  is_emergency_apparatus: boolean;
}
interface DispatchEvent {
  id: string;
  action: string;
  reason: string | null;
  from_status: string | null;
  to_status: string | null;
  recorded_at: string;
  received_at: string;
  requires_resolution: boolean;
  resolved_at: string | null;
  unit_id: string | null;
}
interface Board {
  hold: { parade_hold: boolean; parade_hold_reason: string | null };
  units: Unit[];
  events: DispatchEvent[];
}

const PRE_RELEASE = ["not_arrived", "checked_in", "staged", "ready", "held"];
const TONE: Record<string, "neutral" | "info" | "warn" | "good" | "bad"> = {
  not_arrived: "neutral",
  checked_in: "info",
  staged: "info",
  ready: "good",
  authorized: "warn",
  released: "good",
  on_route: "good",
  finished: "neutral",
  held: "bad",
  skipped: "bad",
  incident: "bad",
};

export function DispatchBoard({
  eventId,
  timezone,
  canDispatch,
  canHold,
  canStage,
}: {
  eventId: string;
  timezone: string;
  canDispatch: boolean;
  canHold: boolean;
  canStage: boolean;
}) {
  const [supabase] = useState(createClient);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [resolveNotes, setResolveNotes] = useState<Record<string, string>>({});

  const { data, error, live, updatedAt, refresh } = useLiveData<Board>(
    eventId,
    ["parade_units", "dispatch_events", "events"],
    async () => {
      const [ev, units, events] = await Promise.all([
        supabase.from("events").select("parade_hold, parade_hold_reason").eq("id", eventId).single(),
        supabase
          .from("parade_units")
          .select("id, name, sequence_number, status, is_emergency_apparatus")
          .eq("event_id", eventId)
          .neq("status", "withdrawn")
          .order("sequence_number", { ascending: true, nullsFirst: false }),
        supabase
          .from("dispatch_events")
          .select("id, action, reason, from_status, to_status, recorded_at, received_at, requires_resolution, resolved_at, unit_id")
          .eq("event_id", eventId)
          .order("received_at", { ascending: false })
          .limit(40),
      ]);
      const err = ev.error ?? units.error ?? events.error;
      if (err) throw new Error(err.message);
      return { hold: ev.data!, units: units.data ?? [], events: events.data ?? [] };
    },
  );

  async function rpc(fn: string, args: Record<string, unknown>, success: string) {
    setBusy(true);
    setFeedback(null);
    const { data: r, error: e } = await supabase.rpc(fn, args);
    setBusy(false);
    const result = r as { ok?: boolean; reason?: string } | null;
    if (e) setFeedback({ tone: "bad", text: e.message });
    else if (result && result.ok === false) setFeedback({ tone: "bad", text: result.reason ?? "Not accepted" });
    else setFeedback({ tone: "good", text: success });
    refresh();
  }

  const withId = () => ({ p_client_action_id: crypto.randomUUID(), p_recorded_at: new Date().toISOString() });

  function askReason(prompt: string) {
    const r = window.prompt(prompt);
    return r && r.trim() ? r.trim() : null;
  }

  if (error && !data) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <p className="text-sm text-muted">Loading dispatch board…</p>;

  const unitName = new Map(data.units.map((u) => [u.id, u.name]));
  const authorized = data.units.find((u) => u.status === "authorized");
  const queue = data.units.filter((u) => PRE_RELEASE.includes(u.status) && u.sequence_number !== null);
  const next = queue.find((u) => u.status === "ready");
  const onRoute = data.units.filter((u) => ["released", "on_route", "incident"].includes(u.status));
  const finished = data.units.filter((u) => u.status === "finished").length;
  const conflicts = data.events.filter((e) => e.requires_resolution && !e.resolved_at);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span className={`inline-flex items-center gap-1.5 ${live ? "text-emerald-700" : "text-amber-800"}`}>
          <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-600" : "bg-amber-500"}`} />
          {live ? "Live" : "Reconnecting — refreshing every 15 s"}
        </span>
        {updatedAt && <span>Updated {updatedAt.toLocaleTimeString()}</span>}
        <span className="ml-auto">
          {queue.length} waiting · {onRoute.length} on route · {finished} finished
        </span>
      </div>

      {data.hold.parade_hold ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-accent p-4 text-white">
          <div className="flex-1">
            <p className="text-lg font-bold">PARADE-WIDE HOLD</p>
            <p className="text-sm">{data.hold.parade_hold_reason}</p>
          </div>
          {canHold && (
            <button className="rounded-md bg-white px-4 py-2 font-semibold text-accent" disabled={busy}
              onClick={() => window.confirm("Resume the parade?") && rpc("set_parade_hold", { p_event_id: eventId, p_hold: false, p_reason: null }, "Parade resumed.")}>
              Resume parade
            </button>
          )}
        </div>
      ) : (
        canHold && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
            <input className="input max-w-md flex-1 text-sm" placeholder="Reason for a parade-wide hold" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} />
            <button className={buttonClass("danger")} disabled={busy || !holdReason.trim()}
              onClick={async () => { await rpc("set_parade_hold", { p_event_id: eventId, p_hold: true, p_reason: holdReason }, "Parade-wide hold in effect."); setHoldReason(""); }}>
              Hold entire parade
            </button>
          </div>
        )
      )}

      {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border-2 border-brand bg-surface p-4">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">At the merge</h2>
          {authorized ? (
            <div className="mt-2 space-y-3">
              <p className="text-2xl font-semibold">
                #{authorized.sequence_number} {authorized.name}
              </p>
              <Badge tone="warn">Authorized — waiting to release</Badge>
              {canDispatch && (
                <div className="flex flex-wrap gap-2">
                  <button className={`${buttonClass()} min-h-14 flex-1 text-lg`} disabled={busy || data.hold.parade_hold}
                    onClick={() => rpc("release_unit", { p_unit_id: authorized.id, ...withId() }, `${authorized.name} released.`)}>
                    Release
                  </button>
                  <button className={buttonClass("secondary")} disabled={busy}
                    onClick={() => { const r = askReason("Why revoke the authorization?"); if (r) rpc("revoke_authorization", { p_unit_id: authorized.id, p_reason: r }, "Authorization revoked."); }}>
                    Revoke
                  </button>
                </div>
              )}
            </div>
          ) : next ? (
            <div className="mt-2 space-y-3">
              <p className="text-sm text-muted">Next ready unit</p>
              <p className="text-2xl font-semibold">
                #{next.sequence_number} {next.name}
              </p>
              {canDispatch && (
                <button className={`${buttonClass()} min-h-14 w-full text-lg`} disabled={busy || data.hold.parade_hold}
                  onClick={() => rpc("authorize_unit", { p_unit_id: next.id, ...withId() }, `${next.name} authorized.`)}>
                  Authorize to merge
                </button>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No unit is ready. Staging marshals mark units ready after check-in.</p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">Needs resolution ({conflicts.length})</h2>
          {conflicts.length === 0 ? (
            <p className="text-sm text-muted">No escalated conflicts.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {conflicts.map((c) => (
                <li key={c.id} className="rounded-md border border-rose-200 bg-rose-50 p-2">
                  <p className="font-medium">{c.unit_id ? unitName.get(c.unit_id) : "Parade"}</p>
                  <p>{c.reason}</p>
                  <p className="text-xs text-muted">Recorded {formatDateTime(c.recorded_at, timezone)}</p>
                  {canDispatch && (
                    <div className="mt-2 flex gap-2">
                      <input className="input py-1 text-xs" placeholder="How was it resolved?" value={resolveNotes[c.id] ?? ""}
                        onChange={(e) => setResolveNotes({ ...resolveNotes, [c.id]: e.target.value })} />
                      <button className={buttonClass("secondary")} disabled={busy || !resolveNotes[c.id]?.trim()}
                        onClick={() => rpc("resolve_dispatch_conflict", { p_dispatch_event_id: c.id, p_note: resolveNotes[c.id] }, "Conflict resolved.")}>
                        Resolve
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-stone-50 text-left text-xs text-muted uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {queue.map((u) => (
              <tr key={u.id} className={u.id === next?.id ? "bg-emerald-50" : ""}>
                <td className="px-3 py-2 font-mono">{u.sequence_number}</td>
                <td className="px-3 py-2">
                  {u.name} {u.is_emergency_apparatus && <Badge tone="bad">Apparatus</Badge>}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={TONE[u.status]}>{u.status.replace(/_/g, " ")}</Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {canStage && ["checked_in", "staged", "held"].includes(u.status) && (
                      <button className={buttonClass("secondary")} disabled={busy}
                        onClick={() => rpc("set_unit_status", { p_unit_id: u.id, p_to: "ready", p_reason: null, ...withId() }, `${u.name} ready.`)}>
                        Ready
                      </button>
                    )}
                    {canStage && u.status !== "held" && (
                      <button className={buttonClass("secondary")} disabled={busy}
                        onClick={() => { const r = askReason(`Hold ${u.name}: reason?`); if (r) rpc("set_unit_status", { p_unit_id: u.id, p_to: "held", p_reason: r, ...withId() }, `${u.name} held.`); }}>
                        Hold
                      </button>
                    )}
                    {canStage && (
                      <button className={buttonClass("secondary")} disabled={busy}
                        onClick={() => { const r = askReason(`Skip ${u.name}: reason?`); if (r) rpc("set_unit_status", { p_unit_id: u.id, p_to: "skipped", p_reason: r, ...withId() }, `${u.name} skipped.`); }}>
                        Skip
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {queue.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted">
                  No units waiting. Units need a lineup position to appear here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 font-semibold">Dispatch log</h2>
        <ol className="space-y-1 text-sm">
          {data.events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2">
              <span className="font-mono text-xs text-muted">{new Date(e.recorded_at).toLocaleTimeString()}</span>
              <span className="font-medium">{e.action.replace(/_/g, " ")}</span>
              {e.unit_id && <span>{unitName.get(e.unit_id) ?? "unit"}</span>}
              {e.reason && <span className="text-muted">— {e.reason}</span>}
              {e.recorded_at !== e.received_at && Math.abs(new Date(e.received_at).getTime() - new Date(e.recorded_at).getTime()) > 5000 && (
                <Badge tone="warn">synced late</Badge>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
