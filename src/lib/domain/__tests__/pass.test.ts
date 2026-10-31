import { describe, expect, it } from "vitest";
import { passStatus, type UnitPass } from "../pass";

const base = (status: string, units_ahead: number | null = 3, staged = true): UnitPass => ({
  event: { name: "Parade", year: 2026, slug: "p", starts_at: null, timezone: "America/New_York", status: "live", parade_hold: false, parade_hold_reason: null, arrival_instructions: null, start: null, direction: null, finish: null, merge_point: "Bay St / Howe St (merge)" },
  unit: { name: "Float", sequence_number: 4, status, entry_name: "Float", category: null, length_ft: 69 },
  staging: staged ? { street: "West Bay Street", lane: 1, block: 2, offset_ft: 0, direction: "eastbound", geometry: null } : null,
  progress: { units_ahead, last_checkpoint: null },
  route: [],
  checkpoints: [],
});

describe("passStatus", () => {
  it("guides an arriving unit", () => {
    expect(passStatus(base("not_arrived")).headline).toBe("Head to your staging spot");
    expect(passStatus(base("not_arrived", 3, false)).detail).toMatch(/will appear here/);
  });
  it("counts units ahead and says when you're next", () => {
    expect(passStatus(base("ready", 3)).detail).toMatch(/3 units ahead/);
    expect(passStatus(base("ready", 1)).detail).toMatch(/1 unit ahead/);
    expect(passStatus(base("ready", 0)).detail).toMatch(/next in line/);
  });
  it("calls an authorized unit forward to the merge", () => {
    const s = passStatus(base("authorized"));
    expect(s.headline).toBe("You're up!");
    expect(s.detail).toMatch(/Bay St \/ Howe St/);
  });
  it("maps every step", () => {
    expect(passStatus(base("on_route")).step).toBe("on_route");
    expect(passStatus(base("finished")).step).toBe("finished");
    expect(passStatus(base("held")).tone).toBe("warn");
  });
});
