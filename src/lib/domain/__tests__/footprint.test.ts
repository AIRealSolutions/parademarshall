import { describe, expect, it } from "vitest";
import { computeFootprint } from "../footprint";

describe("computeFootprint", () => {
  it("includes trailers and separation", () => {
    const f = computeFootprint(30, [{ length_ft: 20, trailer_length_ft: 24 }], 25);
    expect(f).toEqual({ vehicleLengthFt: 44, unitLengthFt: 44, requiredStagingLengthFt: 69 });
  });

  it("uses the declared footprint when it is larger (walking groups, banners)", () => {
    expect(computeFootprint(80, [], 25).requiredStagingLengthFt).toBe(105);
  });
});
