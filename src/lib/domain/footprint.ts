// Unit footprint (§6): placement must account for the complete occupied
// footprint, including towing vehicles, trailers and separation allowances.

export interface VehicleDimensions {
  length_ft: number;
  trailer_length_ft?: number | null;
}

export interface Footprint {
  /** Sum of vehicle and trailer lengths. */
  vehicleLengthFt: number;
  /** The larger of the declared footprint and the vehicle total. */
  unitLengthFt: number;
  /** Unit length plus separation: the space a staging assignment must reserve. */
  requiredStagingLengthFt: number;
}

export function computeFootprint(
  declaredLengthFt: number,
  vehicles: VehicleDimensions[],
  separationFt: number,
): Footprint {
  const vehicleLengthFt = round1(
    vehicles.reduce((sum, v) => sum + (v.length_ft || 0) + (v.trailer_length_ft || 0), 0),
  );
  const unitLengthFt = round1(Math.max(declaredLengthFt || 0, vehicleLengthFt));
  return { vehicleLengthFt, unitLengthFt, requiredStagingLengthFt: round1(unitLengthFt + separationFt) };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
