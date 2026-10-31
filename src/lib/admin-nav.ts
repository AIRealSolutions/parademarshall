export interface AdminSection {
  slug: string;
  label: string;
  /** Roles that see this section; undefined means all staff. */
  roles?: string[];
  summary: string;
}

// Order follows SDS §4, "Administrative application".
export const ADMIN_SECTIONS: AdminSection[] = [
  { slug: "", label: "Director Dashboard", summary: "Registration, staging and operational status at a glance." },
  { slug: "applications", label: "Applications", summary: "Review, approve or request corrections to entries." },
  { slug: "units", label: "Unit Registry", summary: "Dispatchable units, footprints, split units and QR passes." },
  { slug: "staging", label: "Staging Map", summary: "Draw staging segments, lanes and blocks; assign units by measured footprint; detect conflicts." },
  { slug: "lineup", label: "Lineup Builder", summary: "Drag-and-drop procession order independent of staging location, with feasibility warnings." },
  { slug: "dispatch", label: "Dispatch Center", summary: "Single active release authorization at the Bay/Howe merge, holds and parade-wide hold/resume." },
  { slug: "checkpoints", label: "Checkpoints", summary: "Marshal-reported checkpoint passage and route progress." },
  { slug: "safety", label: "Safety & Alerts", summary: "Incidents, restrictions and authorized safety notices." },
  { slug: "communications", label: "Communications", summary: "Email/SMS to participants, staff alerts and public announcements." },
  { slug: "volunteers", label: "Volunteers", summary: "Marshal and volunteer assignments by position." },
  { slug: "reports", label: "Reports", summary: "Participation, dispatch intervals, staging utilization, incidents and year-over-year history." },
  { slug: "settings", label: "Event Settings", summary: "Event status, dates, registration window and defaults." },
  { slug: "audit", label: "Audit History", roles: ["parade_director", "assistant_director"], summary: "Timestamped record of approvals, assignments and dispatch actions." },
];
