// Application lifecycle (FR-02). The database function
// public.application_transition_actor() is authoritative; this mirror drives the UI.

export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "needs_information",
  "approved",
  "waitlisted",
  "assigned",
  "checked_in",
  "completed",
  "withdrawn",
  "rejected",
  "no_show",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under Review",
  needs_information: "Needs Information",
  approved: "Approved",
  waitlisted: "Waitlisted",
  assigned: "Assigned",
  checked_in: "Checked In",
  completed: "Completed",
  withdrawn: "Withdrawn",
  rejected: "Rejected",
  no_show: "No Show",
};

export type TransitionActor = "owner" | "reviewer" | "director" | "owner_or_director";

const WITHDRAWABLE: ApplicationStatus[] = [
  "draft",
  "submitted",
  "under_review",
  "needs_information",
  "approved",
  "waitlisted",
  "assigned",
];

export function transitionActor(from: ApplicationStatus, to: ApplicationStatus): TransitionActor | null {
  const is = (...s: ApplicationStatus[]) => s.includes(from);
  if (to === "submitted" && is("draft", "needs_information")) return "owner";
  if (to === "under_review" && is("submitted")) return "reviewer";
  if (to === "needs_information" && is("submitted", "under_review")) return "reviewer";
  if (to === "waitlisted" && is("submitted", "under_review", "approved")) return "reviewer";
  if (to === "approved" && is("under_review", "waitlisted")) return "director";
  if (to === "rejected" && is("submitted", "under_review", "needs_information", "waitlisted")) return "director";
  if (to === "assigned" && is("approved")) return "director";
  if (to === "approved" && is("assigned")) return "director";
  if (to === "no_show" && is("assigned")) return "director";
  if (to === "completed" && is("assigned", "checked_in")) return "director";
  if (to === "withdrawn" && is(...WITHDRAWABLE)) return "owner_or_director";
  return null;
}

export interface Capabilities {
  isOwner: boolean;
  isReviewer: boolean;
  isDirector: boolean;
}

export function canPerform(actor: TransitionActor, caps: Capabilities): boolean {
  switch (actor) {
    case "owner":
      return caps.isOwner;
    case "reviewer":
      return caps.isReviewer || caps.isDirector;
    case "director":
      return caps.isDirector;
    case "owner_or_director":
      return caps.isOwner || caps.isDirector;
  }
}

/**
 * Transitions offered in the review UI. "assigned" is excluded: it follows from
 * approving a staging placement, not from a button on the application.
 */
export function availableTransitions(from: ApplicationStatus, caps: Capabilities): ApplicationStatus[] {
  return APPLICATION_STATUSES.filter((to) => {
    if (to === "assigned") return false;
    const actor = transitionActor(from, to);
    return actor !== null && canPerform(actor, caps);
  });
}

export function requiresNote(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return (
    to === "needs_information" || to === "rejected" || to === "no_show" || (from === "assigned" && to === "approved")
  );
}

/** Participants may edit only while drafting or answering a request for information. */
export function isEditableByParticipant(status: ApplicationStatus): boolean {
  return status === "draft" || status === "needs_information";
}

export function statusTone(status: ApplicationStatus): "neutral" | "info" | "warn" | "good" | "bad" {
  switch (status) {
    case "submitted":
    case "under_review":
      return "info";
    case "needs_information":
    case "waitlisted":
      return "warn";
    case "approved":
    case "assigned":
    case "checked_in":
    case "completed":
      return "good";
    case "rejected":
    case "no_show":
    case "withdrawn":
      return "bad";
    default:
      return "neutral";
  }
}
