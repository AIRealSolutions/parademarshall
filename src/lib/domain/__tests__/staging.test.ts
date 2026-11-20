import { describe, expect, it } from "vitest";
import { checkPlacement, firstFreeOffset, flowExit, flowPath, flowTree, lineupFeasibility, type LayoutBlock, type LayoutLane, type StagedPosition } from "../staging";

const block = (assignments: [number, number][] = [], extra: Partial<LayoutBlock> = {}): LayoutBlock => ({
  id: "b",
  block_number: 1,
  usable_length_ft: 300,
  permitted_width_ft: 11,
  base_status: "open",
  effective_status: "open",
  safety_restricted: false,
  accessibility_notes: null,
  turning_notes: null,
  restriction_notes: null,
  geometry: null,
  assignments: assignments.map(([s, l], i) => ({
    id: `a${i}`,
    unit_id: `u${i}`,
    unit_name: `Unit ${i}`,
    sequence_number: null,
    unit_status: "not_arrived",
    start_offset_ft: s,
    occupied_length_ft: l,
    status: "approved",
    flag_reason: null,
    override_reason: null,
    instructions_sent_at: null,
  })),
  ...extra,
});

const unit = { footprint_length_ft: 44, footprint_width_ft: 9, separation_ft: 25 };

describe("firstFreeOffset", () => {
  it("fills gaps before appending", () => {
    expect(firstFreeOffset(block([[100, 50]]), 69)).toBe(0);
    expect(firstFreeOffset(block([[0, 50], [100, 50]]), 40)).toBe(50);
    expect(firstFreeOffset(block([[0, 50], [100, 50]]), 69)).toBe(150);
    expect(firstFreeOffset(block([[0, 250]]), 69)).toBeNull();
  });
});

describe("checkPlacement", () => {
  it("accepts a valid placement", () => {
    expect(checkPlacement(block(), unit, 0, 69)).toEqual([]);
  });
  it("flags short reservations, overflow, width, overlap and closures", () => {
    const msgs = (p: ReturnType<typeof checkPlacement>) => p.map((x) => x.message).join(" | ");
    expect(msgs(checkPlacement(block(), unit, 0, 44))).toMatch(/Needs 69 ft/);
    expect(msgs(checkPlacement(block(), unit, 250, 69))).toMatch(/Doesn't fit/);
    expect(msgs(checkPlacement(block([], { permitted_width_ft: 8 }), unit, 0, 69))).toMatch(/wide/);
    expect(msgs(checkPlacement(block([[50, 60]]), unit, 0, 69))).toMatch(/Overlaps Unit 0/);
    expect(checkPlacement(block([], { effective_status: "temporarily_closed" }), unit, 0, 69)[0].severity).toBe("error");
    expect(checkPlacement(block([], { effective_status: "restricted" }), unit, 0, 69)[0].severity).toBe("warning");
    expect(
      checkPlacement(block([], { effective_status: "restricted", safety_restricted: true }), unit, 0, 69)[0].severity,
    ).toBe("error");
  });
});

describe("lineupFeasibility", () => {
  const pos = (unit_id: string, block_number: number, start: number, lane = "L1"): [string, StagedPosition] => [
    unit_id,
    { unit_id, zone: "West Bay", lane_id: lane, lane_label: `West Bay ${lane}`, block_number, start_offset_ft: start },
  ];
  const positions = new Map([pos("a", 1, 0), pos("b", 1, 80), pos("c", 2, 0), pos("d", 1, 0, "L2")]);

  it("accepts front-to-back order", () => {
    expect(lineupFeasibility(["a", "d", "b", "c"], positions)).toEqual([]);
  });
  it("warns when a unit must pass another in its lane", () => {
    const w = lineupFeasibility(["b", "a", "c"], positions);
    expect(w).toHaveLength(1);
    expect(w[0].unit_ids).toEqual(["a", "b"]);
  });
});

describe("staging traffic flow", () => {
  const zone = (id: string, street_name: string, feeds_into_zone_id: string | null, laneCount = 1) => ({
    id,
    street_name,
    feeds_into_zone_id,
    lanes: Array.from({ length: laneCount }, (_, i) => ({ id: `${id}-${i}` })) as unknown as LayoutLane[],
  });
  // West to east along Bay Street; the merge is at Howe, between Lord and Atlantic.
  const zones = [
    zone("caswell", "South Caswell Avenue", "wbay"),
    zone("lord", "South Lord Street", "wbay", 2),
    zone("wbay", "West Bay Street", null, 2),
    zone("ebay", "East Bay Street", null, 2),
    zone("atlantic", "South Atlantic Avenue", "ebay"),
    zone("rhett", "South Rhett Street", "ebay"),
  ];

  it("follows each side street onto its side of Bay Street toward the merge", () => {
    expect(flowPath(zones, "caswell")).toEqual(["South Caswell Avenue", "West Bay Street"]);
    expect(flowPath(zones, "rhett")).toEqual(["South Rhett Street", "East Bay Street"]);
    expect(flowPath(zones, "ebay")).toEqual(["East Bay Street"]);
  });

  it("stops instead of looping forever on a bad chain", () => {
    const looped = [zone("a", "A", "b"), zone("b", "B", "a")];
    expect(flowPath(looped, "a")).toEqual(["A", "B"]);
  });

  it("roots the tree at both Bay Street approaches to the merge", () => {
    const tree = flowTree(zones);
    expect(tree.map((n) => n.zone.id)).toEqual(["wbay", "ebay"]);
    expect(tree[0].feeders.map((n) => n.zone.id)).toEqual(["caswell", "lord"]);
    expect(tree[1].feeders.map((n) => n.zone.id)).toEqual(["atlantic", "rhett"]);
  });
});

describe("flowExit", () => {
  it("names the parade start after the merge", () => {
    expect(
      flowExit([
        { name: "Fire Department (finish)", sequence: 5, is_merge_point: false, is_finish: true },
        { name: "Bay St / Howe St (merge)", sequence: 1, is_merge_point: true, is_finish: false },
        { name: "Moore St / Howe St (parade start)", sequence: 2, is_merge_point: false, is_finish: false },
      ]),
    ).toBe("Moore St / Howe St (parade start)");
  });
});
