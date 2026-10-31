import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { Card, Notice, PageHeader } from "@/components/ui";

interface Report {
  registration: Record<string, number>;
  categories: { category: string; submitted: number; approved: number }[];
  participation: Record<string, number>;
  dispatch: {
    releases: number;
    first_release: string | null;
    last_release: string | null;
    avg_interval_seconds: number | null;
    min_interval_seconds: number | null;
    max_interval_seconds: number | null;
    holds: number;
    conflicts: number;
  };
  staging: { zone: string; usable_ft: number; reserved_ft: number; blocks: number; blocks_unavailable: number }[];
  incidents: { total: number; open: number; by_severity: Record<string, number> };
  history: { year: number; slug: string; submitted: number; approved: number; finished: number }[];
}

const dur = (s: number | null) => (s === null ? "—" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

export default async function ReportsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await requireStaffEvent(slug);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_report", { p_event_id: event.id });
  if (error || !data) return <Notice tone="bad">Could not load reports: {error?.message}</Notice>;
  const r = data as Report;
  const maxHist = Math.max(1, ...r.history.map((h) => h.submitted));

  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          <div className="flex gap-4 text-sm">
            <Link href={`/admin/${slug}/plan`} className="text-brand hover:underline">
              Printable operational plan
            </Link>
            <a href={`/admin/${slug}/reports/units.csv`} className="text-brand hover:underline">
              Export units (CSV)
            </a>
          </div>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Registration">
          <Stats
            items={[
              ["Submitted", r.registration.submitted],
              ["Approved", r.registration.approved],
              ["Organizations", r.registration.organizations],
              ["Participants approved", r.registration.participants_approved],
              ["Waitlisted", r.registration.waitlisted],
              ["Rejected", r.registration.rejected],
              ["Withdrawn", r.registration.withdrawn],
              ["No-shows", r.registration.no_show],
            ]}
          />
        </Card>
        <Card title="Parade day">
          <Stats
            items={[
              ["Units", r.participation.units_total],
              ["Checked in", r.participation.units_checked_in],
              ["Finished", r.participation.units_finished],
              ["Not arrived", r.participation.units_not_arrived],
              ["Skipped", r.participation.units_skipped],
              ["Parade holds", r.dispatch.holds],
            ]}
          />
        </Card>
        <Card title="Dispatch intervals">
          <Stats
            items={[
              ["Releases", r.dispatch.releases],
              ["Average gap", dur(r.dispatch.avg_interval_seconds)],
              ["Shortest gap", dur(r.dispatch.min_interval_seconds)],
              ["Longest gap", dur(r.dispatch.max_interval_seconds)],
              ["Conflicts", r.dispatch.conflicts],
            ]}
          />
          {r.dispatch.first_release && (
            <p className="mt-3 text-xs text-muted">
              First release {formatDateTime(r.dispatch.first_release, event.timezone)} · last{" "}
              {formatDateTime(r.dispatch.last_release, event.timezone)}
            </p>
          )}
        </Card>
        <Card title="Incidents">
          <Stats
            items={[
              ["Total", r.incidents.total],
              ["Open", r.incidents.open],
              ...(["low", "moderate", "high", "critical"].map((s) => [s[0].toUpperCase() + s.slice(1), r.incidents.by_severity[s] ?? 0]) as [string, number][]),
            ]}
          />
        </Card>
        <Card title="Staging utilization">
          <ul className="space-y-3 text-sm">
            {r.staging.map((z) => {
              const pct = z.usable_ft ? Math.round((z.reserved_ft / z.usable_ft) * 100) : 0;
              return (
                <li key={z.zone}>
                  <div className="flex justify-between">
                    <span>{z.zone}</span>
                    <span className="tabular-nums text-muted">
                      {z.reserved_ft} / {z.usable_ft} ft · {pct}%{z.blocks_unavailable ? ` · ${z.blocks_unavailable} block(s) closed` : ""}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-stone-100">
                    <div className="h-2 rounded bg-brand" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Categories">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted uppercase">
              <tr>
                <th className="py-1 font-medium">Category</th>
                <th className="py-1 text-right font-medium">Submitted</th>
                <th className="py-1 text-right font-medium">Approved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.categories.map((c) => (
                <tr key={c.category}>
                  <td className="py-1.5">{c.category}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.submitted}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.approved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Year over year">
          <ul className="space-y-2 text-sm">
            {r.history.map((h) => (
              <li key={h.slug} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3">
                <span className="font-medium">{h.year}</span>
                <div className="h-3 rounded bg-stone-100">
                  <div className="h-3 rounded bg-brand/70" style={{ width: `${(h.submitted / maxHist) * 100}%` }} />
                </div>
                <span className="text-xs text-muted tabular-nums">
                  {h.submitted} submitted · {h.approved} approved · {h.finished} finished
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Stats({ items }: { items: [string, number | string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="text-xl font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
