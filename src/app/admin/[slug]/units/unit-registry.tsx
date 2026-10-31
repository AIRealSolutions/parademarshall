"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, EmptyState, Notice, buttonClass } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { reissuePass, splitUnit, updateUnit } from "@/lib/actions/staff";

export interface RegistryUnit {
  id: string;
  name: string;
  sequence_number: number | null;
  status: string;
  group_label: string | null;
  is_final_unit: boolean;
  is_emergency_apparatus: boolean;
  public_visible: boolean;
  notes: string | null;
  footprint_length_ft: number;
  footprint_width_ft: number;
  separation_ft: number;
  application_id: string | null;
  entry_name: string | null;
  organization: string | null;
  category: string | null;
  vehicles: { id: string; vehicle_type: string; length_ft: number; trailer_length_ft: number }[];
  staging: string | null;
}

export function UnitRegistry({ slug, units, canEdit }: { slug: string; units: RegistryUnit[]; canEdit: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const action = useAction();
  const shown = units.filter((u) =>
    `${u.name} ${u.organization ?? ""} ${u.category ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
  );

  if (units.length === 0) return <EmptyState>No units yet. Approve applications to create them.</EmptyState>;

  return (
    <div className="space-y-3">
      <input className="input max-w-sm" placeholder="Filter units…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter units" />
      {action.error && <Notice tone="bad">{action.error}</Notice>}
      {action.message && <Notice tone="good">{action.message}</Notice>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {shown.map((u) => (
          <li key={u.id} className="p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-10 font-mono text-sm text-muted">{u.sequence_number ? `#${u.sequence_number}` : "—"}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {u.name}
                  {u.group_label && u.group_label !== u.name && <span className="text-sm text-muted"> · {u.group_label}</span>}
                </p>
                <p className="text-xs text-muted">
                  {u.organization} · {u.category} · {u.footprint_length_ft} ft + {u.separation_ft} ft sep · {u.vehicles.length} vehicle(s)
                </p>
                <p className="text-xs">{u.staging ?? <span className="text-amber-800">No staging placement</span>}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {u.is_final_unit && <Badge tone="info">Final unit</Badge>}
                {u.is_emergency_apparatus && <Badge tone="bad">Apparatus</Badge>}
                {!u.public_visible && <Badge>Hidden from public</Badge>}
                <Badge tone={u.status === "withdrawn" ? "bad" : u.status === "finished" ? "good" : "neutral"}>{u.status.replace(/_/g, " ")}</Badge>
              </div>
              <div className="flex gap-3 text-sm">
                {u.application_id && (
                  <Link href={`/admin/${slug}/applications/${u.application_id}`} className="text-brand hover:underline">
                    Entry
                  </Link>
                )}
                {canEdit && (
                  <button className="text-brand hover:underline" onClick={() => setOpenId(openId === u.id ? null : u.id)}>
                    {openId === u.id ? "Close" : "Manage"}
                  </button>
                )}
              </div>
            </div>
            {openId === u.id && <UnitEditor unit={u} action={action} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UnitEditor({ unit, action }: { unit: RegistryUnit; action: ReturnType<typeof useAction> }) {
  const [v, setV] = useState({
    name: unit.name,
    group_label: unit.group_label ?? "",
    is_emergency_apparatus: unit.is_emergency_apparatus,
    public_visible: unit.public_visible,
    notes: unit.notes ?? "",
  });
  const [splitName, setSplitName] = useState("");
  const [splitVehicles, setSplitVehicles] = useState<string[]>([]);

  return (
    <div className="mt-3 grid gap-4 rounded-md bg-stone-50 p-3 md:grid-cols-2">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(() => updateUnit({ id: unit.id, ...v }), "Unit saved.");
        }}
      >
        <h4 className="text-sm font-semibold">Details</h4>
        <input className="input text-sm" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label="Unit name" />
        <input className="input text-sm" placeholder="Group label (keeps related units together)" value={v.group_label} onChange={(e) => setV({ ...v, group_label: e.target.value })} />
        <textarea className="input text-sm" rows={2} placeholder="Internal notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.is_emergency_apparatus} onChange={(e) => setV({ ...v, is_emergency_apparatus: e.target.checked })} />
          Emergency apparatus
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.public_visible} onChange={(e) => setV({ ...v, public_visible: e.target.checked })} />
          Show in public lineup
        </label>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass()} disabled={action.pending}>
            Save
          </button>
          <button
            type="button"
            className={buttonClass("secondary")}
            disabled={action.pending}
            onClick={() => {
              if (window.confirm("Issue a new QR pass? The old pass will stop working.")) {
                action.run(() => reissuePass(unit.id), "New pass issued. The participant will see it on their entry page.");
              }
            }}
          >
            Reissue pass
          </button>
        </div>
      </form>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Split into a separate unit</h4>
        {unit.status !== "not_arrived" ? (
          <p className="text-xs text-muted">Only units that haven&apos;t arrived can be split.</p>
        ) : unit.vehicles.length < 2 ? (
          <p className="text-xs text-muted">Needs at least two vehicles.</p>
        ) : (
          <>
            <p className="text-xs text-muted">Choose the vehicles that will be dispatched separately.</p>
            {unit.vehicles.map((veh) => (
              <label key={veh.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={splitVehicles.includes(veh.id)}
                  onChange={(e) =>
                    setSplitVehicles((s) => (e.target.checked ? [...s, veh.id] : s.filter((x) => x !== veh.id)))
                  }
                />
                {veh.vehicle_type} ({Number(veh.length_ft) + Number(veh.trailer_length_ft)} ft)
              </label>
            ))}
            <input className="input text-sm" placeholder="New unit name" value={splitName} onChange={(e) => setSplitName(e.target.value)} />
            <button
              className={buttonClass("secondary")}
              disabled={action.pending || !splitName.trim() || splitVehicles.length === 0}
              onClick={async () => {
                const ok = await action.run(() => splitUnit(unit.id, splitName, splitVehicles), `${splitName} created.`);
                if (ok) {
                  setSplitName("");
                  setSplitVehicles([]);
                }
              }}
            >
              Split unit
            </button>
          </>
        )}
      </div>
    </div>
  );
}
