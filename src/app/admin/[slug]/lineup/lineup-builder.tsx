"use client";

import { useMemo, useState } from "react";
import { Badge, Notice, buttonClass } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { lineupFeasibility, type StagedPosition } from "@/lib/domain/staging";
import { publishPublicPlan, saveLineup } from "@/lib/actions/staff";

export interface LineupUnit {
  id: string;
  name: string;
  sequence_number: number | null;
  status: string;
  group_label: string | null;
  is_final_unit: boolean;
  is_emergency_apparatus: boolean;
  category: string | null;
  staging: StagedPosition | null;
}

const isBand = (u: LineupUnit) => /band/i.test(u.category ?? "");

export function LineupBuilder({
  eventId,
  units,
  canEdit,
  canPublish,
}: {
  eventId: string;
  units: LineupUnit[];
  canEdit: boolean;
  canPublish: boolean;
}) {
  const byId = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const initial = units.filter((u) => u.sequence_number !== null).map((u) => u.id);
  const [order, setOrder] = useState<string[]>(initial);
  const [finalId, setFinalId] = useState<string | null>(units.find((u) => u.is_final_unit)?.id ?? null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const action = useAction();

  const pool = units.filter((u) => !order.includes(u.id));
  const dirty = order.join() !== initial.join() || finalId !== (units.find((u) => u.is_final_unit)?.id ?? null);

  const warnings = useMemo(() => {
    const positions = new Map<string, StagedPosition>();
    for (const u of units) if (u.staging) positions.set(u.id, u.staging);
    const list = lineupFeasibility(order, positions).map((w) => w.message);
    order.forEach((id, i) => {
      const u = byId.get(id)!;
      const next = byId.get(order[i + 1] ?? "");
      if (next && isBand(u) && isBand(next)) list.push(`#${i + 1} ${u.name} and #${i + 2} ${next.name} are consecutive marching bands.`);
      if (!u.staging) list.push(`#${i + 1} ${u.name} has no staging placement.`);
    });
    // Group members should stay together.
    const seen = new Map<string, number>();
    order.forEach((id, i) => {
      const g = byId.get(id)?.group_label;
      if (!g) return;
      const last = seen.get(g);
      if (last !== undefined && last !== i - 1) list.push(`Group "${g}" is split across the lineup (#${last + 1} and #${i + 1}).`);
      seen.set(g, i);
    });
    if (finalId && order[order.length - 1] !== finalId) list.push("The designated final unit is not last.");
    return list;
  }, [order, units, byId, finalId]);

  const move = (id: string, to: number) =>
    setOrder((o) => {
      const without = o.filter((x) => x !== id);
      without.splice(Math.max(0, Math.min(to, without.length)), 0, id);
      return without;
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Procession order ({order.length})</h2>
          {canEdit && (
            <div className="ml-auto flex gap-2">
              <button className={buttonClass("secondary")} disabled={!dirty || action.pending} onClick={() => { setOrder(initial); setFinalId(units.find((u) => u.is_final_unit)?.id ?? null); }}>
                Reset
              </button>
              <button
                className={buttonClass()}
                disabled={!dirty || action.pending}
                onClick={() => action.run(() => saveLineup(eventId, order, finalId), (n) => `Lineup saved (${n} units).`)}
              >
                Save lineup
              </button>
            </div>
          )}
        </div>
        {action.error && <div className="mb-3"><Notice tone="bad">{action.error}</Notice></div>}
        {action.message && <div className="mb-3"><Notice tone="good">{action.message}</Notice></div>}
        <ol
          className="divide-y divide-border rounded-lg border border-border bg-surface"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragId && !order.includes(dragId)) setOrder((o) => [...o, dragId]);
            setDragId(null);
          }}
        >
          {order.length === 0 && <li className="p-6 text-center text-sm text-muted">Drag units here, or use “Add”.</li>}
          {order.map((id, i) => {
            const u = byId.get(id)!;
            return (
              <li
                key={id}
                draggable={canEdit}
                onDragStart={() => setDragId(id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.stopPropagation();
                  if (dragId) move(dragId, i);
                  setDragId(null);
                }}
                className={`flex items-center gap-3 px-3 py-2 ${dragId === id ? "opacity-40" : ""} ${canEdit ? "cursor-grab" : ""}`}
              >
                <span className="w-8 text-right font-mono text-sm text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className="truncate text-xs text-muted">
                    {u.category}
                    {u.group_label ? ` · ${u.group_label}` : ""} · {u.staging ? `${u.staging.lane_label} B${u.staging.block_number}` : "not staged"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {u.is_emergency_apparatus && <Badge tone="bad">Apparatus</Badge>}
                  {finalId === id && <Badge tone="info">Final</Badge>}
                  {canEdit && (
                    <>
                      <IconBtn label={`Move ${u.name} up`} disabled={i === 0} onClick={() => move(id, i - 1)}>↑</IconBtn>
                      <IconBtn label={`Move ${u.name} down`} disabled={i === order.length - 1} onClick={() => move(id, i + 1)}>↓</IconBtn>
                      <IconBtn label={`Mark ${u.name} as final unit`} onClick={() => setFinalId(finalId === id ? null : id)}>⚑</IconBtn>
                      <IconBtn label={`Remove ${u.name} from lineup`} onClick={() => setOrder((o) => o.filter((x) => x !== id))}>✕</IconBtn>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <aside className="space-y-4">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">Feasibility</h2>
          {warnings.length === 0 ? (
            <p className="text-sm text-emerald-800">No conflicts between this order and the staging plan.</p>
          ) : (
            <ul className="space-y-1.5 text-sm text-amber-900">
              {warnings.map((w) => (
                <li key={w}>! {w}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Warnings are advisory. Units in the same lane leave front to back.</p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold">Not in lineup ({pool.length})</h2>
          <ul className="space-y-1 text-sm">
            {pool.map((u) => (
              <li key={u.id} draggable={canEdit} onDragStart={() => setDragId(u.id)} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-stone-50">
                <span className="min-w-0 truncate">
                  {u.name} <span className="text-xs text-muted">{u.category}</span>
                </span>
                {canEdit && (
                  <button className="text-xs text-brand hover:underline" onClick={() => setOrder((o) => [...o, u.id])}>
                    Add
                  </button>
                )}
              </li>
            ))}
            {pool.length === 0 && <li className="text-muted">All approved units are in the lineup.</li>}
          </ul>
        </section>

        {canPublish && (
          <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">Publish to spectators</h2>
            <p className="text-xs text-muted">
              Publishes the saved lineup, route and checkpoints to the public page. Contact details and staging locations are never included.
            </p>
            <input className="input text-sm" placeholder="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <button className={buttonClass()} disabled={action.pending || dirty} onClick={() => action.run(() => publishPublicPlan(eventId, notes), "Public lineup published.")}>
              Publish public plan
            </button>
            {dirty && <p className="text-xs text-amber-800">Save the lineup before publishing.</p>}
          </section>
        )}
      </aside>
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="h-8 w-8 rounded border border-border text-sm hover:bg-stone-100 disabled:opacity-30">
      {children}
    </button>
  );
}
