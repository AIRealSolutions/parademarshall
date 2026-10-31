import type { GeoLine, GeoPoint } from "./staging";

export interface UnitPass {
  event: {
    name: string;
    year: number;
    slug: string;
    starts_at: string | null;
    timezone: string;
    status: string;
    parade_hold: boolean;
    parade_hold_reason: string | null;
    arrival_instructions: string | null;
    start: string | null;
    direction: string | null;
    finish: string | null;
    merge_point: string | null;
  };
  unit: {
    name: string;
    sequence_number: number | null;
    status: string;
    entry_name: string | null;
    category: string | null;
    length_ft: number;
  };
  staging: {
    street: string;
    lane: number;
    block: number;
    offset_ft: number;
    direction: string;
    geometry: GeoLine | null;
  } | null;
  progress: { units_ahead: number | null; last_checkpoint: { name: string; at: string } | null };
  route: { name: string; geometry: GeoLine }[];
  checkpoints: { code: string; name: string; is_finish: boolean; is_merge_point: boolean; geometry: GeoPoint }[];
}

export type PassStep = "approved" | "checked_in" | "ready" | "on_route" | "finished";

export const PASS_STEPS: { key: PassStep; label: string }[] = [
  { key: "approved", label: "Approved" },
  { key: "checked_in", label: "Checked in" },
  { key: "ready", label: "Ready" },
  { key: "on_route", label: "On the route" },
  { key: "finished", label: "Finished" },
];

/** Where a unit is in the parade-night journey, and what to tell the participant. */
export function passStatus(p: UnitPass): { step: PassStep; headline: string; detail: string; tone: "info" | "good" | "warn" | "bad" } {
  const merge = p.event.merge_point ?? "the merge";
  const ahead = p.progress.units_ahead;
  const aheadText = ahead === null ? "" : ahead === 0 ? " You're next in line." : ` ${ahead} unit${ahead === 1 ? "" : "s"} ahead of you.`;
  switch (p.unit.status) {
    case "not_arrived":
      return {
        step: "approved",
        tone: "info",
        headline: p.staging ? "Head to your staging spot" : "You're approved",
        detail: p.staging
          ? "Show this pass to a staging marshal when you arrive."
          : "Your staging location will appear here once the director assigns it.",
      };
    case "checked_in":
    case "staged":
      return { step: "checked_in", tone: "good", headline: "You're checked in", detail: `Stay with your unit and listen for marshals.${aheadText}` };
    case "ready":
      return { step: "ready", tone: "good", headline: "Ready to go", detail: `Wait for a marshal to wave you toward ${merge}.${aheadText}` };
    case "authorized":
      return { step: "ready", tone: "warn", headline: "You're up!", detail: `Move to ${merge} now and follow the dispatch marshal's signal.` };
    case "released":
    case "on_route":
      return {
        step: "on_route",
        tone: "good",
        headline: "You're on the parade route",
        detail: p.progress.last_checkpoint ? `Last reported near ${p.progress.last_checkpoint.name}. Keep moving and enjoy it!` : "Keep moving and enjoy it!",
      };
    case "finished":
      return { step: "finished", tone: "good", headline: "Finished. Thank you!", detail: "Follow marshals' directions to leave the finish area." };
    case "held":
      return { step: "checked_in", tone: "warn", headline: "Your unit is on hold", detail: "A marshal will let you know when you can continue." };
    case "incident":
      return { step: "on_route", tone: "bad", headline: "Stop and follow marshal instructions", detail: "Parade staff are responding." };
    case "skipped":
      return { step: "approved", tone: "bad", headline: "Your unit was skipped", detail: "Please see a marshal." };
    default:
      return { step: "approved", tone: "info", headline: "Parade pass", detail: "" };
  }
}
