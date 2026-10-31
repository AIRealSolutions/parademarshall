export type SectionGroup = "Overview" | "Entries" | "Planning" | "Parade day" | "People & outreach" | "Records";

export interface AdminSection {
  slug: string;
  label: string;
  /** Short label for the phone tab bar. */
  short: string;
  group: SectionGroup;
  /** Roles that see this section; undefined means all staff. */
  roles?: string[];
  summary: string;
}

export const SECTION_GROUPS: SectionGroup[] = ["Overview", "Entries", "Planning", "Parade day", "People & outreach", "Records"];

// Order follows SDS §4, "Administrative application".
export const ADMIN_SECTIONS: AdminSection[] = [
  { slug: "", label: "Director Dashboard", short: "Home", group: "Overview", summary: "What needs attention, at a glance." },
  { slug: "applications", label: "Applications", short: "Entries", group: "Entries", summary: "Review, approve or request corrections to entries." },
  { slug: "units", label: "Unit Registry", short: "Units", group: "Entries", summary: "Units, footprints, split units, passes and signs." },
  { slug: "staging", label: "Staging Map", short: "Staging", group: "Planning", summary: "Staging streets, blocks and unit placement." },
  { slug: "lineup", label: "Lineup Builder", short: "Lineup", group: "Planning", summary: "Procession order and publishing the public lineup." },
  { slug: "dispatch", label: "Dispatch Center", short: "Dispatch", group: "Parade day", summary: "Release units at the merge; parade-wide hold." },
  { slug: "checkpoints", label: "Checkpoints", short: "Route", group: "Parade day", summary: "Where each unit has been reported." },
  { slug: "safety", label: "Safety & Alerts", short: "Safety", group: "Parade day", summary: "Incidents and street restrictions." },
  { slug: "communications", label: "Communications", short: "Messages", group: "People & outreach", summary: "Announcements and the email/text log." },
  { slug: "engagement", label: "Engagement", short: "Engage", group: "People & outreach", summary: "Sponsors, People's Choice voting and photos." },
  { slug: "volunteers", label: "Volunteers", short: "Staff", group: "People & outreach", summary: "Staff roles, positions and shifts." },
  { slug: "reports", label: "Reports", short: "Reports", group: "Records", summary: "Totals, dispatch timing, printable plan and exports." },
  { slug: "settings", label: "Event Settings", short: "Settings", group: "Records", summary: "Event status, dates, categories and defaults." },
  { slug: "audit", label: "Audit History", short: "Audit", group: "Records", roles: ["parade_director", "assistant_director", "fire_chief", "police_chief"], summary: "Who changed what, and when." },
];

/** The operational sections traffic officers use; the rest hold participant details. */
export const TRAFFIC_OFFICER_SECTIONS = new Set(["", "staging", "lineup", "dispatch", "checkpoints", "safety"]);

/** Sections pinned to the phone tab bar (the rest live under Menu). */
export const TAB_SLUGS = ["", "applications", "dispatch", "safety"];
export const TRAFFIC_TAB_SLUGS = ["", "staging", "dispatch", "safety"];

export function visibleSections(roles: string[], isAdmin: boolean) {
  const trafficOnly = !isAdmin && roles.length > 0 && roles.every((r) => r === "traffic_officer");
  const sections = ADMIN_SECTIONS.filter(
    (s) =>
      (isAdmin || !s.roles || s.roles.some((r) => roles.includes(r))) &&
      (!trafficOnly || TRAFFIC_OFFICER_SECTIONS.has(s.slug)),
  );
  const tabs = (trafficOnly ? TRAFFIC_TAB_SLUGS : TAB_SLUGS)
    .map((slug) => sections.find((s) => s.slug === slug))
    .filter((s): s is AdminSection => Boolean(s));
  return { sections, tabs };
}
