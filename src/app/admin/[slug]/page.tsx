import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/domain/applications";
import { Card, EmptyState, Notice, PageHeader, StatusBadge } from "@/components/ui";

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

export default async function DirectorDashboard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await requireStaffEvent(slug);
  const supabase = await createClient();

  const now = new Date().toISOString();
  const [{ data, error }, { data: recent }, { data: staffNotices }] = await Promise.all([
    supabase.rpc("event_dashboard", { p_event_id: event.id }),
    supabase
      .from("applications")
      .select("id, entry_name, status, submitted_at, organizations(name)")
      .eq("event_id", event.id)
      .neq("status", "draft")
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(6),
    supabase
      .from("announcements")
      .select("id, title, body, is_emergency")
      .eq("event_id", event.id)
      .eq("audience", "staff")
      .lte("published_at", now)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("published_at", { ascending: false })
      .limit(3),
  ]);
  const d = data as Dashboard | null;
  if (error || !d) return <Notice tone="bad">Could not load the dashboard: {error?.message}</Notice>;

  const by = d.applications_by_status;
  const awaiting = (by.submitted ?? 0) + (by.under_review ?? 0);
  const approved = (by.approved ?? 0) + (by.assigned ?? 0) + (by.checked_in ?? 0) + (by.completed ?? 0);
  const maxCat = Math.max(1, ...d.applications_by_category.map((c) => c.count));

  const attention = [
    d.flagged_assignments > 0 && `${d.flagged_assignments} staging assignment(s) flagged by a restriction need reassignment.`,
    d.unresolved_dispatch_conflicts > 0 && `${d.unresolved_dispatch_conflicts} dispatch conflict(s) need human resolution.`,
    d.open_incidents > 0 && `${d.open_incidents} open incident(s).`,
    (by.needs_information ?? 0) > 0 && `${by.needs_information} application(s) waiting on participants for information.`,
  ].filter(Boolean) as string[];

  return (
    <>
      <PageHeader title="Director Dashboard" subtitle={`Event status: ${event.status.replace(/_/g, " ")}`} />
      {staffNotices?.map((n) => (
        <div key={n.id} className="mb-3">
          <Notice tone={n.is_emergency ? "bad" : "info"}>
            <span className="font-semibold">{n.title}:</span> {n.body}
          </Notice>
        </div>
      ))}
      {attention.length > 0 && (
        <div className="mb-6">
          <Notice tone="warn">
            <ul className="list-disc space-y-1 pl-4">
              {attention.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Awaiting review" value={awaiting} href={`/admin/${slug}/applications?status=submitted,under_review`} />
        <Stat label="Approved entries" value={approved} href={`/admin/${slug}/applications?status=approved,assigned,checked_in,completed`} />
        <Stat label="Participants (approved)" value={d.participants_total} />
        <Stat label="Active restrictions" value={d.active_restrictions} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Applications by status">
          <ul className="space-y-2 text-sm">
            {(Object.keys(STATUS_LABELS) as ApplicationStatus[])
              .filter((s) => by[s])
              .map((s) => (
                <li key={s} className="flex items-center justify-between">
                  <StatusBadge status={s} />
                  <span className="font-mono">{by[s]}</span>
                </li>
              ))}
          </ul>
          {Object.keys(by).length === 0 && <EmptyState>No applications yet.</EmptyState>}
        </Card>

        <Card title="Entries by category">
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
        </Card>

        <Card
          title="Recent submissions"
          actions={
            <Link href={`/admin/${slug}/applications`} className="text-sm text-brand hover:underline">
              All applications
            </Link>
          }
        >
          {recent && recent.length > 0 ? (
            <ul className="divide-y divide-border text-sm">
              {recent.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/${slug}/applications/${a.id}`} className="flex items-center gap-3 py-2 hover:bg-stone-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{a.entry_name}</p>
                      <p className="text-xs text-muted">
                        {(a.organizations as unknown as { name: string } | null)?.name} ·{" "}
                        {formatDateTime(a.submitted_at, event.timezone)}
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
        </Card>

        <Card title="Units">
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
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-lg hover:ring-2 hover:ring-brand/30">
      {body}
    </Link>
  ) : (
    body
  );
}
