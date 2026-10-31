"use client";

import { useMemo, useState } from "react";
import type { LatLngTuple } from "leaflet";
import { ParadeMap } from "@/components/map";
import { Badge, Notice, buttonClass } from "@/components/ui";
import { useAction } from "@/components/use-action";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  checkPlacement,
  firstFreeOffset,
  reservedLength,
  type LayoutAssignment,
  type LayoutBlock,
  type LayoutLane,
  type LayoutZone,
  type SegmentStatus,
  type StagingLayout,
} from "@/lib/domain/staging";
import {
  addBlock,
  approveAssignment,
  approvePlan,
  assignUnit,
  createRestriction,
  markFieldValidated,
  releaseAssignment,
  sendArrivalInstructions,
  updateBlock,
  updateGeometry,
  updateLane,
} from "@/lib/actions/staff";

export interface StagingUnit {
  id: string;
  name: string;
  sequence_number: number | null;
  status: string;
  footprint_length_ft: number;
  footprint_width_ft: number;
  separation_ft: number;
  is_emergency_apparatus: boolean;
  category: string | null;
  application_status: string | null;
}

interface Version {
  version_number: number;
  stage: string;
  notes: string | null;
  created_at: string;
}

type DrawTarget = { kind: "zone" | "route_segment" | "checkpoint"; id: string; label: string; mode: "line" | "point" };

const PLACEABLE_APP_STATUSES = ["approved", "assigned", "checked_in"];

export function StagingWorkspace({
  eventId,
  layout,
  units,
  versions,
  canEdit,
  canApprovePlan,
}: {
  eventId: string;
  layout: StagingLayout;
  units: StagingUnit[];
  versions: Version[];
  canEdit: boolean;
  canApprovePlan: boolean;
}) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [tab, setTab] = useState<"block" | "units" | "layout">("units");
  const [draw, setDraw] = useState<(DrawTarget & { points: LatLngTuple[] }) | null>(null);
  const action = useAction();

  const index = useMemo(() => {
    const blocks = new Map<string, { block: LayoutBlock; lane: LayoutLane; zone: LayoutZone }>();
    const assigned = new Map<string, { assignment: LayoutAssignment; block: LayoutBlock; lane: LayoutLane; zone: LayoutZone }>();
    for (const zone of layout.zones)
      for (const lane of zone.lanes)
        for (const block of lane.blocks) {
          blocks.set(block.id, { block, lane, zone });
          for (const a of block.assignments) assigned.set(a.unit_id, { assignment: a, block, lane, zone });
        }
    return { blocks, assigned };
  }, [layout]);

  const unassigned = units.filter(
    (u) => !index.assigned.has(u.id) && PLACEABLE_APP_STATUSES.includes(u.application_status ?? "") && u.status === "not_arrived",
  );
  const flagged = [...index.assigned.values()].filter((x) => x.assignment.status === "flagged");
  const proposed = [...index.assigned.values()].filter((x) => x.assignment.status === "proposed");
  const awaitingInstructions = [...index.assigned.values()].filter(
    (x) => x.assignment.status === "approved" && !x.assignment.instructions_sent_at,
  ).length;

  const selected = selectedBlockId ? index.blocks.get(selectedBlockId) : undefined;
  const latestApproved = versions.find((v) => v.stage === "approved");
  const changedSinceApproval = latestApproved && versions[0]?.stage === "draft";

  function selectBlock(id: string) {
    setSelectedBlockId(id);
    setTab("block");
  }

  async function saveDrawing() {
    if (!draw) return;
    const coords = draw.points.map(([lat, lng]) => [lng, lat]);
    const geojson = draw.mode === "point" ? { type: "Point", coordinates: coords[0] } : { type: "LineString", coordinates: coords };
    const ok = await action.run(() => updateGeometry(draw.kind, draw.id, geojson), `${draw.label} saved.`);
    if (ok) setDraw(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {(Object.keys(STATUS_COLORS) as SegmentStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-5 rounded" style={{ background: STATUS_COLORS[s] }} />
            {STATUS_LABELS[s]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-5 rounded bg-blue-700/60" />
          Parade route
        </span>
        <span className="ml-auto text-muted">
          {latestApproved
            ? `Plan v${latestApproved.version_number} approved${changedSinceApproval ? " · changed since approval" : ""}`
            : "Staging plan not yet approved"}
        </span>
      </div>

      {layout.zones.some((z) => !z.field_validated) && (
        <Notice tone="warn">
          Some staging geometry is a planning placeholder and has not been field-validated. Confirm boundaries, road
          widths and emergency access with the responsible authorities before approving the plan.
        </Notice>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-2">
          {draw && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-sm">
              <span className="font-medium">Editing {draw.label}:</span>
              <span className="text-muted">
                {draw.mode === "point"
                  ? "click the map to place the point."
                  : `click to add points${draw.kind === "zone" ? ", starting at the end nearest the merge" : ""} (${draw.points.length}).`}
              </span>
              <span className="ml-auto flex gap-2">
                {draw.mode === "line" && (
                  <button className={buttonClass("secondary")} onClick={() => setDraw({ ...draw, points: draw.points.slice(0, -1) })}>
                    Undo
                  </button>
                )}
                <button className={buttonClass("secondary")} onClick={() => setDraw(null)}>
                  Cancel
                </button>
                <button
                  className={buttonClass()}
                  disabled={action.pending || draw.points.length < (draw.mode === "point" ? 1 : 2)}
                  onClick={saveDrawing}
                >
                  Save
                </button>
              </span>
            </div>
          )}
          <ParadeMap
            layout={layout}
            selectedBlockId={selectedBlockId}
            selectedZoneId={draw?.kind === "zone" ? draw.id : selected?.zone.id}
            onSelectBlock={selectBlock}
            draw={draw ? { mode: draw.mode, points: draw.points, onChange: (points) => setDraw({ ...draw, points }) } : null}
            className="h-[60vh] min-h-[22rem]"
          />
          {action.error && <Notice tone="bad">{action.error}</Notice>}
          {action.message && <Notice tone="good">{action.message}</Notice>}
        </div>

        <aside className="min-w-0 rounded-lg border border-border bg-surface">
          <div role="tablist" className="flex border-b border-border text-sm">
            {(
              [
                ["units", `Units (${unassigned.length + flagged.length})`],
                ["block", "Block"],
                ["layout", "Layout"],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2.5 font-medium ${tab === t ? "border-b-2 border-brand text-brand" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
            {tab === "units" && (
              <UnitsTab
                eventId={eventId}
                unassigned={unassigned}
                flagged={flagged}
                proposed={proposed}
                awaitingInstructions={awaitingInstructions}
                canEdit={canEdit}
                canApprovePlan={canApprovePlan}
                onSelectBlock={selectBlock}
                action={action}
              />
            )}
            {tab === "block" &&
              (selected ? (
                <BlockPanel
                  key={selected.block.id}
                  eventId={eventId}
                  {...selected}
                  units={unassigned}
                  canEdit={canEdit}
                  action={action}
                />
              ) : (
                <p className="text-sm text-muted">Select a block on the map, or from the Layout tab.</p>
              ))}
            {tab === "layout" && (
              <LayoutTab
                layout={layout}
                canEdit={canEdit}
                selectedBlockId={selectedBlockId}
                onSelectBlock={selectBlock}
                onDraw={(t) => setDraw({ ...t, points: [] })}
                action={action}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

type Action = ReturnType<typeof useAction>;

function UnitsTab({
  eventId,
  unassigned,
  flagged,
  proposed,
  awaitingInstructions,
  canEdit,
  canApprovePlan,
  onSelectBlock,
  action,
}: {
  eventId: string;
  unassigned: StagingUnit[];
  flagged: { assignment: LayoutAssignment; block: LayoutBlock; lane: LayoutLane; zone: LayoutZone }[];
  proposed: { assignment: LayoutAssignment; block: LayoutBlock; lane: LayoutLane; zone: LayoutZone }[];
  awaitingInstructions: number;
  canEdit: boolean;
  canApprovePlan: boolean;
  onSelectBlock: (id: string) => void;
  action: Action;
}) {
  const [notes, setNotes] = useState("");
  return (
    <>
      {flagged.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-accent">Needs reassignment ({flagged.length})</h3>
          <ul className="space-y-2">
            {flagged.map(({ assignment: a, block, lane, zone }) => (
              <li key={a.id} className="rounded-md border border-rose-200 bg-rose-50 p-2 text-sm">
                <button className="text-left font-medium hover:underline" onClick={() => onSelectBlock(block.id)}>
                  {a.unit_name}
                </button>
                <p className="text-xs">
                  {zone.street_name} L{lane.lane_number} B{block.block_number}: {a.flag_reason}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Unassigned units ({unassigned.length})</h3>
        {unassigned.length === 0 ? (
          <p className="text-sm text-muted">Every approved unit has a placement.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {unassigned.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className="font-medium">{u.sequence_number ? `#${u.sequence_number} ` : ""}{u.name}</span>
                  <span className="block text-xs text-muted">
                    {u.category} · needs {u.footprint_length_ft + u.separation_ft} ft · {u.footprint_width_ft} ft wide
                  </span>
                </span>
                {u.is_emergency_apparatus && <Badge tone="bad">Apparatus</Badge>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Select a block on the map to place a unit.</p>
      </section>

      {proposed.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Proposed, awaiting approval ({proposed.length})</h3>
          <ul className="space-y-1 text-sm">
            {proposed.map(({ assignment: a, block, lane, zone }) => (
              <li key={a.id}>
                <button className="hover:underline" onClick={() => onSelectBlock(block.id)}>
                  {a.unit_name}
                </button>{" "}
                <span className="text-xs text-muted">
                  {zone.street_name} L{lane.lane_number} B{block.block_number}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && (
        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Publish to participants</h3>
          <p className="text-xs text-muted">
            Sends staging location emails for approved placements that haven&apos;t been sent yet ({awaitingInstructions}).
            Moved placements must be re-approved before they are sent again.
          </p>
          <button
            className={buttonClass("secondary")}
            disabled={action.pending || awaitingInstructions === 0}
            onClick={() => action.run(() => sendArrivalInstructions(eventId), (n) => `${n ?? 0} instruction email(s) queued.`)}
          >
            Queue arrival instructions
          </button>
        </section>
      )}

      {canApprovePlan && (
        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Approve operational plan</h3>
          <p className="text-xs text-muted">
            Records a versioned snapshot of the staging geometry. Later geometry changes are versioned automatically.
          </p>
          <input className="input text-sm" placeholder="Approval notes (e.g. confirmed with City and Fire)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button
            className={buttonClass()}
            disabled={action.pending}
            onClick={() => action.run(() => approvePlan(eventId, "staging", notes), "Staging plan approved.")}
          >
            Approve staging plan
          </button>
        </section>
      )}
    </>
  );
}

function BlockStrip({ block }: { block: LayoutBlock }) {
  const total = Number(block.usable_length_ft);
  return (
    <div className="relative h-7 overflow-hidden rounded border border-border bg-stone-50" aria-hidden>
      {block.assignments.map((a) => (
        <div
          key={a.id}
          title={a.unit_name}
          className={`absolute inset-y-0 truncate border-r border-white px-1 text-[10px] leading-7 text-white ${
            a.status === "approved" ? "bg-brand" : a.status === "flagged" ? "bg-accent" : "bg-amber-600"
          }`}
          style={{ left: `${(Number(a.start_offset_ft) / total) * 100}%`, width: `${(Number(a.occupied_length_ft) / total) * 100}%` }}
        >
          {a.sequence_number ? `#${a.sequence_number}` : a.unit_name}
        </div>
      ))}
    </div>
  );
}

function BlockPanel({
  eventId,
  block,
  lane,
  zone,
  units,
  canEdit,
  action,
}: {
  eventId: string;
  block: LayoutBlock;
  lane: LayoutLane;
  zone: LayoutZone;
  units: StagingUnit[];
  canEdit: boolean;
  action: Action;
}) {
  const [unitId, setUnitId] = useState("");
  const unit = units.find((u) => u.id === unitId);
  const required = unit ? unit.footprint_length_ft + unit.separation_ft : 0;
  const [offset, setOffset] = useState("0");
  const [occupied, setOccupied] = useState("");
  const [override, setOverride] = useState("");
  const [approveOverride, setApproveOverride] = useState("");
  const [editing, setEditing] = useState(false);
  const [restricting, setRestricting] = useState(false);

  function chooseUnit(id: string) {
    setUnitId(id);
    const u = units.find((x) => x.id === id);
    if (u) {
      const need = u.footprint_length_ft + u.separation_ft;
      setOccupied(String(need));
      setOffset(String(firstFreeOffset(block, need) ?? 0));
    }
  }

  const problems = unit ? checkPlacement(block, unit, Number(offset), Number(occupied)) : [];
  const blocking = problems.some((p) => p.severity === "error");
  const reserved = reservedLength(block);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">
          {zone.street_name} · lane {lane.lane_number} · block {block.block_number}
        </h3>
        <p className="text-xs text-muted">
          {lane.direction} · {block.usable_length_ft} ft usable · {block.permitted_width_ft} ft wide · {reserved} ft reserved
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={block.effective_status === "open" ? "good" : block.effective_status === "restricted" ? "warn" : "bad"}>
            {STATUS_LABELS[block.effective_status]}
          </Badge>
          {block.safety_restricted && <Badge tone="bad">Safety restriction</Badge>}
        </div>
        {(block.accessibility_notes || block.turning_notes) && (
          <p className="mt-2 text-xs">
            {block.accessibility_notes && <span className="block">Accessibility: {block.accessibility_notes}</span>}
            {block.turning_notes && <span className="block">Turning: {block.turning_notes}</span>}
          </p>
        )}
      </div>

      <BlockStrip block={block} />

      <ul className="space-y-2 text-sm">
        {block.assignments.map((a) => (
          <li key={a.id} className="rounded-md border border-border p-2">
            <div className="flex items-start justify-between gap-2">
              <span>
                <span className="font-medium">
                  {a.sequence_number ? `#${a.sequence_number} ` : ""}
                  {a.unit_name}
                </span>
                <span className="block text-xs text-muted">
                  {a.start_offset_ft}–{Number(a.start_offset_ft) + Number(a.occupied_length_ft)} ft
                  {a.instructions_sent_at ? " · instructions sent" : ""}
                </span>
              </span>
              <Badge tone={a.status === "approved" ? "good" : a.status === "flagged" ? "bad" : "warn"}>{a.status}</Badge>
            </div>
            {a.flag_reason && <p className="mt-1 text-xs text-accent">{a.flag_reason}</p>}
            {a.override_reason && <p className="mt-1 text-xs">Override: {a.override_reason}</p>}
            {canEdit && (
              <div className="mt-2 flex flex-wrap gap-2">
                {a.status !== "approved" && (
                  <>
                    {block.effective_status === "restricted" && (
                      <input
                        className="input py-1 text-xs"
                        placeholder="Override reason"
                        value={approveOverride}
                        onChange={(e) => setApproveOverride(e.target.value)}
                      />
                    )}
                    <button
                      className={buttonClass()}
                      disabled={action.pending}
                      onClick={() => action.run(() => approveAssignment(a.id, approveOverride), `${a.unit_name} approved.`)}
                    >
                      Approve
                    </button>
                  </>
                )}
                <button
                  className={buttonClass("secondary")}
                  disabled={action.pending}
                  onClick={() => action.run(() => releaseAssignment(a.id), `${a.unit_name} removed from block.`)}
                >
                  Remove
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <section className="space-y-2 border-t border-border pt-4">
          <h4 className="text-sm font-semibold">Place a unit</h4>
          <select className="input text-sm" value={unitId} onChange={(e) => chooseUnit(e.target.value)} aria-label="Unit">
            <option value="">Choose an unassigned unit…</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.sequence_number ? `#${u.sequence_number} ` : ""}
                {u.name} ({u.footprint_length_ft + u.separation_ft} ft)
              </option>
            ))}
          </select>
          {unit && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  Offset from block start (ft)
                  <input className="input mt-1 text-sm" type="number" min={0} value={offset} onChange={(e) => setOffset(e.target.value)} />
                </label>
                <label className="text-xs">
                  Reserved length (ft)
                  <input className="input mt-1 text-sm" type="number" min={required} value={occupied} onChange={(e) => setOccupied(e.target.value)} />
                </label>
              </div>
              {block.effective_status === "restricted" && !block.safety_restricted && (
                <input className="input text-sm" placeholder="Override reason (required)" value={override} onChange={(e) => setOverride(e.target.value)} />
              )}
              {problems.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {problems.map((p) => (
                    <li key={p.message} className={p.severity === "error" ? "text-accent" : "text-amber-800"}>
                      {p.severity === "error" ? "✕" : "!"} {p.message}
                    </li>
                  ))}
                </ul>
              )}
              <button
                className={buttonClass()}
                disabled={action.pending || blocking}
                onClick={async () => {
                  const ok = await action.run(
                    () =>
                      assignUnit({
                        event_id: eventId,
                        unit_id: unit.id,
                        block_id: block.id,
                        start_offset_ft: Number(offset),
                        occupied_length_ft: Number(occupied),
                        override_reason: override,
                      }),
                    `${unit.name} proposed for this block. Approve it to confirm.`,
                  );
                  if (ok) setUnitId("");
                }}
              >
                Propose placement
              </button>
            </>
          )}
        </section>
      )}

      {canEdit && (
        <section className="space-y-2 border-t border-border pt-4">
          <div className="flex gap-3 text-sm">
            <button className="text-brand hover:underline" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close block details" : "Edit block details"}
            </button>
            <button className="text-accent hover:underline" onClick={() => setRestricting((v) => !v)}>
              {restricting ? "Cancel restriction" : "Restrict this block"}
            </button>
          </div>
          {editing && <BlockEditForm block={block} action={action} onDone={() => setEditing(false)} />}
          {restricting && (
            <RestrictionForm eventId={eventId} target="block" targetId={block.id} action={action} onDone={() => setRestricting(false)} />
          )}
        </section>
      )}
    </div>
  );
}

function BlockEditForm({ block, action, onDone }: { block: LayoutBlock; action: Action; onDone: () => void }) {
  const [v, setV] = useState({
    usable_length_ft: String(block.usable_length_ft),
    permitted_width_ft: String(block.permitted_width_ft),
    base_status: block.base_status,
    accessibility_notes: block.accessibility_notes ?? "",
    turning_notes: block.turning_notes ?? "",
  });
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await action.run(
          () =>
            updateBlock({
              id: block.id,
              ...v,
              usable_length_ft: Number(v.usable_length_ft),
              permitted_width_ft: Number(v.permitted_width_ft),
            }),
          "Block updated.",
        );
        if (ok) onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          Usable length (ft)
          <input className="input mt-1 text-sm" type="number" value={v.usable_length_ft} onChange={(e) => setV({ ...v, usable_length_ft: e.target.value })} />
        </label>
        <label className="text-xs">
          Permitted width (ft)
          <input className="input mt-1 text-sm" type="number" value={v.permitted_width_ft} onChange={(e) => setV({ ...v, permitted_width_ft: e.target.value })} />
        </label>
      </div>
      <label className="block text-xs">
        Base status
        <select className="input mt-1 text-sm" value={v.base_status} onChange={(e) => setV({ ...v, base_status: e.target.value as SegmentStatus })}>
          {(Object.keys(STATUS_LABELS) as SegmentStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <input className="input text-sm" placeholder="Accessibility notes" value={v.accessibility_notes} onChange={(e) => setV({ ...v, accessibility_notes: e.target.value })} />
      <input className="input text-sm" placeholder="Turning / clearance notes" value={v.turning_notes} onChange={(e) => setV({ ...v, turning_notes: e.target.value })} />
      <button className={buttonClass()} disabled={action.pending}>
        Save block
      </button>
    </form>
  );
}

export function RestrictionForm({
  eventId,
  target,
  targetId,
  action,
  onDone,
}: {
  eventId: string;
  target: "zone" | "lane" | "block";
  targetId: string;
  action: Action;
  onDone?: () => void;
}) {
  const [v, setV] = useState({ status: "temporarily_closed", reason: "", responsible_authority: "", is_safety: true, effective_to: "" });
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await action.run(
          () =>
            createRestriction({
              event_id: eventId,
              target,
              target_id: targetId,
              ...v,
              effective_to: v.effective_to ? new Date(v.effective_to).toISOString() : null,
            }),
          "Restriction recorded. Affected placements were flagged for review; no one was moved.",
        );
        if (ok) onDone?.();
      }}
    >
      <select className="input text-sm" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} aria-label="Restriction status">
        <option value="restricted">Restricted</option>
        <option value="temporarily_closed">Temporarily closed</option>
        <option value="unavailable">Unavailable</option>
      </select>
      <input className="input text-sm" placeholder="Reason (e.g. shoreline construction)" required value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      <input className="input text-sm" placeholder="Responsible authority" required value={v.responsible_authority} onChange={(e) => setV({ ...v, responsible_authority: e.target.value })} />
      <label className="block text-xs">
        Ends (optional)
        <input className="input mt-1 text-sm" type="datetime-local" value={v.effective_to} onChange={(e) => setV({ ...v, effective_to: e.target.value })} />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={v.is_safety} onChange={(e) => setV({ ...v, is_safety: e.target.checked })} />
        Safety restriction (cannot be overridden by the director)
      </label>
      <button className={buttonClass("danger")} disabled={action.pending}>
        Record restriction
      </button>
    </form>
  );
}

function LayoutTab({
  layout,
  canEdit,
  selectedBlockId,
  onSelectBlock,
  onDraw,
  action,
}: {
  layout: StagingLayout;
  canEdit: boolean;
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
  onDraw: (t: DrawTarget) => void;
  action: Action;
}) {
  return (
    <div className="space-y-5 text-sm">
      {layout.zones.map((z) => (
        <section key={z.id} className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-semibold">{z.street_name}</h3>
            <span className="text-xs text-muted">
              {z.primary_use.replace("_", " ")}
              {z.length_ft ? ` · ${z.length_ft} ft` : ""}
            </span>
          </div>
          {!z.field_validated && <p className="text-xs text-amber-800">Not field-validated</p>}
          {canEdit && (
            <div className="flex gap-3 text-xs">
              <button className="text-brand hover:underline" onClick={() => onDraw({ kind: "zone", id: z.id, label: `${z.street_name} line`, mode: "line" })}>
                Redraw street line
              </button>
              {!z.field_validated && (
                <button
                  className="text-brand hover:underline"
                  onClick={() => action.run(() => markFieldValidated("staging_zones", z.id), `${z.street_name} marked field-validated.`)}
                >
                  Mark field-validated
                </button>
              )}
            </div>
          )}
          {z.lanes.map((l) => (
            <div key={l.id} className="rounded-md border border-border p-2">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="font-medium">Lane {l.lane_number}</span>
                {canEdit ? (
                  <select
                    className="rounded border border-border bg-surface px-1 py-0.5"
                    value={l.direction}
                    aria-label={`Lane ${l.lane_number} direction`}
                    onChange={(e) => action.run(() => updateLane({ id: l.id, direction: e.target.value, width_ft: l.width_ft }), "Lane direction updated.")}
                  >
                    {["northbound", "southbound", "eastbound", "westbound"].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-muted">{l.direction}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {l.blocks.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => onSelectBlock(b.id)}
                    className={`rounded px-2 py-1 text-xs text-white ${b.id === selectedBlockId ? "ring-2 ring-offset-1 ring-violet-500" : ""}`}
                    style={{ background: STATUS_COLORS[b.effective_status] }}
                    title={`${b.usable_length_ft} ft, ${reservedLength(b)} reserved`}
                  >
                    B{b.block_number} · {reservedLength(b)}/{b.usable_length_ft}
                  </button>
                ))}
                {canEdit && (
                  <button
                    className="rounded border border-dashed border-border px-2 py-1 text-xs text-muted hover:border-brand"
                    onClick={() => action.run(() => addBlock(l.id, 250, l.width_ft), "Block added.")}
                  >
                    + block
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      ))}

      <section className="space-y-2 border-t border-border pt-4">
        <h3 className="font-semibold">Route</h3>
        <ul className="space-y-1">
          {layout.route.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <span>
                {r.sequence}. {r.name} <span className="text-xs text-muted">{r.length_ft} ft</span>
              </span>
              {canEdit && (
                <button className="text-xs text-brand hover:underline" onClick={() => onDraw({ kind: "route_segment", id: r.id, label: r.name, mode: "line" })}>
                  Redraw
                </button>
              )}
            </li>
          ))}
        </ul>
        <h3 className="pt-2 font-semibold">Checkpoints</h3>
        <ul className="space-y-1">
          {layout.checkpoints.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span>
                {c.sequence}. {c.name}
                {!c.field_validated && <span className="text-xs text-amber-800"> · unvalidated</span>}
              </span>
              {canEdit && (
                <span className="flex gap-2 text-xs">
                  <button className="text-brand hover:underline" onClick={() => onDraw({ kind: "checkpoint", id: c.id, label: c.name, mode: "point" })}>
                    Move
                  </button>
                  {!c.field_validated && (
                    <button className="text-brand hover:underline" onClick={() => action.run(() => markFieldValidated("checkpoints", c.id), `${c.name} validated.`)}>
                      Validate
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
