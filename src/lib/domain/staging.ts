// Staging layout types (from the staging_layout() RPC) and placement helpers.
// The database re-validates every placement; these helpers guide the director.

export type SegmentStatus = "open" | "restricted" | "temporarily_closed" | "unavailable";

export interface GeoLine {
  type: "LineString";
  coordinates: [number, number][];
}
export interface GeoPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface LayoutAssignment {
  id: string;
  unit_id: string;
  unit_name: string;
  sequence_number: number | null;
  unit_status: string;
  start_offset_ft: number;
  occupied_length_ft: number;
  status: "proposed" | "approved" | "flagged" | "released";
  flag_reason: string | null;
  override_reason: string | null;
  instructions_sent_at: string | null;
}

export interface LayoutBlock {
  id: string;
  block_number: number;
  usable_length_ft: number;
  permitted_width_ft: number;
  base_status: SegmentStatus;
  effective_status: SegmentStatus;
  safety_restricted: boolean;
  accessibility_notes: string | null;
  turning_notes: string | null;
  restriction_notes: string | null;
  geometry: GeoLine | null;
  assignments: LayoutAssignment[];
}

export interface LayoutLane {
  id: string;
  lane_number: number;
  direction: string;
  width_ft: number;
  surveyed: boolean;
  geometry: GeoLine | null;
  blocks: LayoutBlock[];
}

export interface LayoutZone {
  id: string;
  code: string;
  street_name: string;
  description: string | null;
  primary_use: "fire_apparatus" | "general" | "overflow";
  field_validated: boolean;
  length_ft: number | null;
  geometry: GeoLine | null;
  lanes: LayoutLane[];
}

export interface LayoutCheckpoint {
  id: string;
  code: string;
  name: string;
  sequence: number;
  is_merge_point: boolean;
  is_finish: boolean;
  field_validated: boolean;
  geometry: GeoPoint;
}

export interface LayoutRouteSegment {
  id: string;
  sequence: number;
  name: string;
  length_ft: number;
  field_validated: boolean;
  geometry: GeoLine;
}

export interface LayoutRestriction {
  id: string;
  status: SegmentStatus;
  reason: string;
  is_safety: boolean;
  zone_id: string | null;
  lane_id: string | null;
  block_id: string | null;
  responsible_authority: string;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
}

export interface StagingLayout {
  zones: LayoutZone[];
  route: LayoutRouteSegment[];
  checkpoints: LayoutCheckpoint[];
  restrictions: LayoutRestriction[];
}

export const STATUS_COLORS: Record<SegmentStatus, string> = {
  open: "#2f7d4f",
  restricted: "#c98a0b",
  temporarily_closed: "#b3261e",
  unavailable: "#6b6f6c",
};

export const STATUS_LABELS: Record<SegmentStatus, string> = {
  open: "Open",
  restricted: "Restricted",
  temporarily_closed: "Temporarily closed",
  unavailable: "Unavailable",
};

const active = (a: { status: string }) => a.status !== "released";

export function reservedLength(block: LayoutBlock) {
  return block.assignments.filter(active).reduce((s, a) => s + Number(a.occupied_length_ft), 0);
}

/** First offset where `length` fits without overlapping, or null if it doesn't fit anywhere. */
export function firstFreeOffset(block: LayoutBlock, length: number, ignoreAssignmentId?: string): number | null {
  const taken = block.assignments
    .filter((a) => active(a) && a.id !== ignoreAssignmentId)
    .map((a) => [Number(a.start_offset_ft), Number(a.start_offset_ft) + Number(a.occupied_length_ft)] as const)
    .sort((x, y) => x[0] - y[0]);
  let cursor = 0;
  for (const [start, end] of taken) {
    if (start - cursor >= length) return cursor;
    cursor = Math.max(cursor, end);
  }
  return Number(block.usable_length_ft) - cursor >= length ? cursor : null;
}

export type PlacementProblem = { severity: "error" | "warning"; message: string };

/** Mirrors validate_staging_assignment() so the director sees problems before saving. */
export function checkPlacement(
  block: LayoutBlock,
  unit: { footprint_length_ft: number; footprint_width_ft: number; separation_ft: number },
  startOffset: number,
  occupied: number,
  ignoreAssignmentId?: string,
): PlacementProblem[] {
  const problems: PlacementProblem[] = [];
  const required = Number(unit.footprint_length_ft) + Number(unit.separation_ft);
  if (block.effective_status === "temporarily_closed" || block.effective_status === "unavailable") {
    problems.push({ severity: "error", message: `Block is ${STATUS_LABELS[block.effective_status].toLowerCase()}.` });
  } else if (block.effective_status === "restricted") {
    problems.push(
      block.safety_restricted
        ? { severity: "error", message: "Block has a safety restriction. Change the approved plan first." }
        : { severity: "warning", message: "Block is restricted. An override reason is required." },
    );
  }
  if (occupied < required) {
    problems.push({ severity: "error", message: `Needs ${required} ft (footprint + separation); ${occupied} ft entered.` });
  }
  if (startOffset < 0 || startOffset + occupied > Number(block.usable_length_ft)) {
    problems.push({
      severity: "error",
      message: `Doesn't fit: block has ${block.usable_length_ft} ft usable; this ends at ${startOffset + occupied} ft.`,
    });
  }
  if (Number(unit.footprint_width_ft) > Number(block.permitted_width_ft)) {
    problems.push({
      severity: "error",
      message: `Unit is ${unit.footprint_width_ft} ft wide; block permits ${block.permitted_width_ft} ft.`,
    });
  }
  const overlap = block.assignments.find(
    (a) =>
      active(a) &&
      a.id !== ignoreAssignmentId &&
      startOffset < Number(a.start_offset_ft) + Number(a.occupied_length_ft) &&
      Number(a.start_offset_ft) < startOffset + occupied,
  );
  if (overlap) problems.push({ severity: "error", message: `Overlaps ${overlap.unit_name}.` });
  return problems;
}

export interface StagedPosition {
  unit_id: string;
  zone: string;
  lane_id: string;
  lane_label: string;
  block_number: number;
  start_offset_ft: number;
}

export function stagedPositions(layout: StagingLayout): Map<string, StagedPosition> {
  const out = new Map<string, StagedPosition>();
  for (const z of layout.zones)
    for (const l of z.lanes)
      for (const b of l.blocks)
        for (const a of b.assignments.filter(active))
          out.set(a.unit_id, {
            unit_id: a.unit_id,
            zone: z.street_name,
            lane_id: l.id,
            lane_label: `${z.street_name} lane ${l.lane_number}`,
            block_number: b.block_number,
            start_offset_ft: Number(a.start_offset_ft),
          });
  return out;
}

export interface LineupWarning {
  unit_ids: string[];
  message: string;
}

/**
 * Units leave a lane front to back (block 1, offset 0 first). A unit placed
 * behind another in the same lane but scheduled earlier would have to pass it.
 */
export function lineupFeasibility(orderedUnitIds: string[], positions: Map<string, StagedPosition>): LineupWarning[] {
  const warnings: LineupWarning[] = [];
  const byLane = new Map<string, { id: string; seq: number; pos: StagedPosition }[]>();
  orderedUnitIds.forEach((id, i) => {
    const pos = positions.get(id);
    if (!pos) return;
    const list = byLane.get(pos.lane_id) ?? [];
    list.push({ id, seq: i + 1, pos });
    byLane.set(pos.lane_id, list);
  });
  for (const list of byLane.values()) {
    const physical = [...list].sort(
      (a, b) => a.pos.block_number - b.pos.block_number || a.pos.start_offset_ft - b.pos.start_offset_ft,
    );
    for (let i = 0; i < physical.length; i++) {
      for (let j = i + 1; j < physical.length; j++) {
        if (physical[j].seq < physical[i].seq) {
          warnings.push({
            unit_ids: [physical[i].id, physical[j].id],
            message: `#${physical[j].seq} is staged behind #${physical[i].seq} in ${physical[i].pos.lane_label} and would have to pass it.`,
          });
        }
      }
    }
  }
  return warnings;
}
