export interface AdminSection {
  slug: string;
  label: string;
  /** Implementation phase from the SDS §9; undefined when available now. */
  phase?: number;
  summary: string;
}

// Order follows SDS §4, "Administrative application".
export const ADMIN_SECTIONS: AdminSection[] = [
  { slug: "", label: "Director Dashboard", summary: "Registration, staging and operational status at a glance." },
  { slug: "applications", label: "Applications", summary: "Review, approve or request corrections to entries." },
  { slug: "units", label: "Unit Registry", phase: 2, summary: "Dispatchable units, footprints, split units and QR passes." },
  { slug: "staging", label: "Staging Map", phase: 2, summary: "Draw staging segments, lanes and blocks; assign units by measured footprint; detect conflicts." },
  { slug: "lineup", label: "Lineup Builder", phase: 3, summary: "Drag-and-drop procession order independent of staging location, with feasibility warnings." },
  { slug: "dispatch", label: "Dispatch Center", phase: 3, summary: "Single active release authorization at the Bay/Howe merge, holds and parade-wide hold/resume." },
  { slug: "checkpoints", label: "Checkpoints", phase: 4, summary: "Marshal-reported checkpoint passage and route progress." },
  { slug: "safety", label: "Safety & Alerts", phase: 4, summary: "Incidents, restrictions and authorized safety notices." },
  { slug: "communications", label: "Communications", phase: 5, summary: "Email/SMS to participants, staff alerts and public announcements." },
  { slug: "volunteers", label: "Volunteers", phase: 4, summary: "Marshal and volunteer assignments by position." },
  { slug: "reports", label: "Reports", phase: 6, summary: "Participation, dispatch intervals, staging utilization, incidents and year-over-year history." },
  { slug: "settings", label: "Event Settings", summary: "Event status, dates, registration window and defaults." },
  { slug: "audit", label: "Audit History", summary: "Timestamped record of approvals, assignments and dispatch actions." },
];
