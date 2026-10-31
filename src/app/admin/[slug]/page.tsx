import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/domain/applications";
import { isDirector, isTrafficOnly } from "@/lib/domain/roles";
import { Badge, EmptyState, Notice, StatusBadge } from "@/components/ui";
import { Collapsible } from "@/components/collapsible";

interface Dashboard {
  applications_by_status: Partial<Record<ApplicationStatus, number>>;
  applications_by_category: { category: string; count: number }[];
  units_by_status: Record<string, number>;
  participants_total: number;
  active_restrictions: number;
  flagged_assignments: number;
  open_incidents: number;
  unresolved_dispatch_conflicts: number;
}

interface AttentionItem {
  count: number;
  label: string;
  href: string;
  tone: "bad" | "warn" | "info";
}

const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);
const DOT = { bad: "bg-accent", warn: "bg-amber-500", info: "bg-sky-500" };
const PLACEABLE = ["approved", "assigned", "checked_in"];

export default async function DirectorDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const supabase = await createClient();
  const base = `/admin/${slug}`;

  const now = new Date().toISOString();
  const [{ data, error }, { data: recent }, { data: staffNotices }, { data: units }, { count: pendingPhotos }] =
    await Promise.all([
      supabase.rpc("event_dashboard", { p_event_id: event.id }),
      supabase
        .from("applications")
        .select("id, entry_name, status, submitted_at, organizations(name)")
        .eq("event_id", event.id)
        .neq("status", "draft")
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(5),
      supabase
        .from("announcements")
        .select("id, title, body, is_emergency")
        .eq("event_id", event.id)
        .eq("audience", "staff")
        .lte("published_at", now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("published_at", { ascending: false })
        .limit(3),
      supabase
        .from("parade_units")
        .select("id, sequence_number, status, applications(status), staging_assignments(status)")
        .eq("event_id", event.id)
        .neq("status", "withdrawn"),
      supabase
        .from("photo_submissions")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("status", "pending"),
    ]);
  const d = data as Dashboard | null;
  if (error || !d) return <Notice tone="bad">Could not load the dashboard: {error?.message}</Notice>;

  const by = d.applications_by_status;
  const awaiting = (by.submitted ?? 0) + (by.under_review ?? 0);
  const approved = (by.approved ?? 0) + (by.assigned ?? 0) + (by.checked_in ?? 0) + (by.completed ?? 0);
  const maxCat = Math.max(1, ...d.applications_by_category.map((c) => c.count));

  const activeUnits = (units ?? []).filter((u) => {
    const s = (u.applications as unknown as { status: string } | null)?.status;
    return !s || PLACEABLE.includes(s);
  });
  const unplaced = activeUnits.filter(
    (u) =>
      u.status === "not_arrived" &&
      !(u.staging_assignments as unknown as { status: string }[]).some((a) => a.status !== "released"),
  ).length;
  const notInLineup = activeUnits.filter((u) => u.sequence_number === null).length;
  const inLineup = activeUnits.length - notInLineup;

  const trafficOnly = isTrafficOnly(access);
  const director = isDirector(access);
  const attention: AttentionItem[] = (
    [
      { count: d.unresolved_dispatch_conflicts, label: pl(d.unresolved_dispatch_conflicts, "dispatch conflict", "dispatch conflicts") + " to resolve", href: `${base}/dispatch`, tone: "bad" },
      { count: d.open_incidents, label: pl(d.open_incidents, "open incident", "open incidents"), href: `${base}/safety`, tone: "bad" },
      { count: d.flagged_assignments, label: pl(d.flagged_assignments, "unit", "units") + " to move off a closed block", href: `${base}/staging`, tone: "bad" },
      !trafficOnly && { count: awaiting, label: pl(awaiting, "entry", "entries") + " waiting for review", href: `${base}/applications?status=submitted,under_review`, tone: "warn" },
      !trafficOnly && { count: unplaced, label: pl(unplaced, "approved unit", "approved units") + " not placed on the staging map", href: `${base}/staging`, tone: "warn" },
      !trafficOnly && { count: notInLineup, label: pl(notInLineup, "unit", "units") + " not in the lineup", href: `${base}/lineup`, tone: "warn" },
      director && { count: pendingPhotos ?? 0, label: pl(pendingPhotos ?? 0, "photo", "photos") + " waiting for approval", href: `${base}/engagement`, tone: "info" },
      !trafficOnly && { count: by.needs_information ?? 0, label: pl(by.needs_information ?? 0, "entry", "entries") + " waiting on the participant", href: `${base}/applications?status=needs_information`, tone: "info" },
    ].filter(Boolean) as AttentionItem[]
  ).filter((a) => a.count > 0);

  const paradeDay = ["operational", "live"].includes(event.status) || event.parade_hold;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Badge tone={event.status === "live" ? "good" : event.status === "draft" ? "neutral" : "info"}>
          {event.status.replace(/_/g, " ")}
        </Badge>
        {event.starts_at && <span className="text-sm text-muted">{formatDateTime(event.starts_at, event.timezone)}</span>}
      </div>

      {staffNotices?.map((n) => (
        <Notice key={n.id} tone={n.is_emergency ? "bad" : "info"}>
          <span className="font-semibold">{n.title}:</span> {n.body}
        </Notice>
      ))}

      <section aria-labelledby="attention" className="overflow-hidden rounded-lg border border-border bg-surface">
        <h2 id="attention" className="border-b border-border px-4 py-3 font-semibold">
          Needs attention
        </h2>
        {attention.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-4 text-sm text-emerald-800">
            <span aria-hidden>✓</span> All caught up.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {attention.map((a) => (
              <li key={a.label}>
                <Link href={a.href} className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-stone-100 hover:bg-stone-50">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[a.tone]}`} aria-hidden />
                  <span className="text-xl font-semibold tabular-nums">{a.count}</span>
                  <span className="min-w-0 flex-1 text-sm">{a.label}</span>
                  <span className="text-muted" aria-hidden>
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {paradeDay && (
        <section aria-label="Parade day">
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">Parade day</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { href: `${base}/dispatch`, label: "Dispatch", sub: event.parade_hold ? "HOLD in effect" : "Release units" },
              { href: `/marshal/${slug}/traffic`, label: "Traffic", sub: "Head, tail, clear streets" },
              { href: `${base}/checkpoints`, label: "Route", sub: "Checkpoint times" },
              { href: `${base}/safety`, label: "Safety", sub: `${d.open_incidents} open` },
            ].map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className={`rounded-lg border p-3 active:bg-stone-100 ${
                  q.label === "Dispatch" && event.parade_hold ? "border-accent bg-rose-50" : "border-border bg-surface"
                }`}
              >
                <span className="block font-semibold">{q.label}</span>
                <span className="block text-xs text-muted">{q.sub}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Totals" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {!trafficOnly && <Stat label="Approved entries" value={approved} href={`${base}/applications?status=approved,assigned,checked_in,completed`} />}
        {!trafficOnly && <Stat label="Participants" value={d.participants_total} />}
        <Stat label="Units in lineup" value={inLineup} href={`${base}/lineup`} />
        <Stat label="Active restrictions" value={d.active_restrictions} href={`${base}/safety`} />
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        {!trafficOnly && (
          <Collapsible title="Recent submissions" meta={recent?.length ? undefined : "none"}>
            {recent && recent.length > 0 ? (
              <ul className="-mx-4 divide-y divide-border">
                {recent.map((a) => (
                  <li key={a.id}>
                    <Link href={`${base}/applications/${a.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{a.entry_name}</p>
                        <p className="truncate text-xs text-muted">
                          {(a.organizations as unknown as { name: string } | null)?.name} · {formatDateTime(a.submitted_at, event.timezone)}
                        </p>
                      </div>
                      <StatusBadge status={a.status as ApplicationStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>No submissions yet.</EmptyState>
            )}
            <Link href={`${base}/applications`} className="mt-2 block text-sm text-brand hover:underline">
              All applications →
            </Link>
          </Collapsible>
        )}

        {!trafficOnly && (
          <Collapsible title="Applications by status" meta={`${Object.values(by).reduce((s, n) => s + (n ?? 0), 0)} total`}>
            {Object.keys(by).length === 0 ? (
              <EmptyState>No applications yet.</EmptyState>
            ) : (
              <ul className="space-y-2 text-sm">
                {(Object.keys(STATUS_LABELS) as ApplicationStatus[])
                  .filter((s) => by[s])
                  .map((s) => (
                    <li key={s}>
                      <Link href={`${base}/applications?status=${s}`} className="flex items-center justify-between hover:underline">
                        <StatusBadge status={s} />
                        <span className="font-mono">{by[s]}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </Collapsible>
        )}

        {!trafficOnly && (
          <Collapsible title="Entries by category" meta={`${d.applications_by_category.length} categories`}>
            {d.applications_by_category.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {d.applications_by_category.map((c) => (
                  <li key={c.category}>
                    <div className="flex justify-between">
                      <span>{c.category}</span>
                      <span className="font-mono">{c.count}</span>
                    </div>
                    <div className="mt-1 h-2 rounded bg-stone-100">
                      <div className="h-2 rounded bg-brand" style={{ width: `${(c.count / maxCat) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>No submitted entries yet.</EmptyState>
            )}
          </Collapsible>
        )}

        <Collapsible title="Units by status" meta={`${activeUnits.length} units`}>
          {Object.keys(d.units_by_status).length > 0 ? (
            <ul className="space-y-1 text-sm">
              {Object.entries(d.units_by_status).map(([s, n]) => (
                <li key={s} className="flex justify-between">
                  <span className="capitalize">{s.replace(/_/g, " ")}</span>
                  <span className="font-mono">{n}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Units are created when applications are approved.</EmptyState>
          )}
        </Collapsible>
      </div>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <div className="h-full rounded-lg border border-border bg-surface px-3 py-2.5 lg:p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums lg:text-3xl">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-lg active:bg-stone-100 hover:ring-2 hover:ring-brand/30">
      {body}
    </Link>
  ) : (
    body
  );
}
