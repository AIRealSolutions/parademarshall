export const EVENT_ROLES = [
  "parade_director",
  "assistant_director",
  "registration_coordinator",
  "staging_marshal",
  "dispatch_controller",
  "checkpoint_marshal",
  "public_safety_liaison",
  "fire_chief",
] as const;

export type EventRole = (typeof EVENT_ROLES)[number];

export const ROLE_LABELS: Record<EventRole, string> = {
  parade_director: "Parade Director",
  assistant_director: "Assistant Director",
  registration_coordinator: "Registration Coordinator",
  staging_marshal: "Staging Marshal",
  dispatch_controller: "Dispatch Controller",
  checkpoint_marshal: "Checkpoint Marshal",
  public_safety_liaison: "Public Safety Liaison",
  fire_chief: "Fire Chief",
};

export interface StaffAccess {
  roles: EventRole[];
  isSystemAdmin: boolean;
}

const has = (a: StaffAccess, ...r: EventRole[]) => a.isSystemAdmin || a.roles.some((x) => r.includes(x));

// Mirrors the SQL helpers is_event_director / is_event_reviewer. UI only;
// the database enforces these through RLS and workflow functions.
export const isDirector = (a: StaffAccess) => has(a, "parade_director", "assistant_director");
export const isChiefDirector = (a: StaffAccess) => has(a, "parade_director");
export const isReviewer = (a: StaffAccess) =>
  has(a, "parade_director", "assistant_director", "registration_coordinator");
/** Leadership that may see every record, including audit history (mirrors is_event_overseer). */
export const isOverseer = (a: StaffAccess) => has(a, "parade_director", "assistant_director", "fire_chief");
export const isStaff = (a: StaffAccess) => a.isSystemAdmin || a.roles.length > 0;
