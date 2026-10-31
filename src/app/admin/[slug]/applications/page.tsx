import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { feet, formatDateTime } from "@/lib/format";
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from "@/lib/domain/applications";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";

const FILTERS: { label: string; statuses: ApplicationStatus[] }[] = [
  { label: "Needs review", statuses: ["submitted", "under_review"] },
  { label: "Waiting on participant", statuses: ["needs_information"] },
  { label: "Approved", statuses: ["approved", "assigned", "checked_in", "completed"] },
  { label: "Waitlisted", statuses: ["waitlisted"] },
  { label: "Closed", statuses: ["rejected", "withdrawn", "no_show"] },
];

export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { event } = await requireStaffEvent(slug);
  const statuses = (sp.status?.split(",") ?? []).filter((s): s is ApplicationStatus =>
    (APPLICATION_STATUSES as readonly string[]).includes(s),
  );

  const supabase = await createClient();
  let query = supabase
    .from("applications")
    .select(
      "id, entry_name, status, submitted_at, participant_count, footprint_length_ft, organizations(name), parade_categories(name)",
    )
    .eq("event_id", event.id)
    .neq("status", "draft")
    .order("submitted_at", { ascending: true, nullsFirst: false });
  if (statuses.length) query = query.in("status", statuses);
  if (sp.q) query = query.ilike("entry_name", `%${sp.q.replace(/[%_]/g, "")}%`);
  const { data: apps, error } = await query;

  const base = `/admin/${slug}/applications`;
  const current = statuses.join(",");

  return (
    <>
      <PageHeader title="Applications" subtitle="Drafts are private to participants until submitted." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        <FilterLink href={base} active={!current}>
          All
        </FilterLink>
        {FILTERS.map((f) => (
          <FilterLink key={f.label} href={`${base}?status=${f.statuses.join(",")}`} active={current === f.statuses.join(",")}>
            {f.label}
          </FilterLink>
        ))}
        </div>
        <form className="sm:ml-auto" action={base}>
          {current && <input type="hidden" name="status" value={current} />}
          <label htmlFor="q" className="sr-only">
            Search entries
          </label>
          <input id="q" name="q" type="search" defaultValue={sp.q} placeholder="Search entries…" className="input py-1.5 text-sm sm:w-56" />
        </form>
      </div>

      {error && <p className="text-sm text-accent">{error.message}</p>}
      {apps && apps.length > 0 ? (
        <>
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface sm:hidden">
          {apps.map((a) => (
            <li key={a.id}>
              <Link href={`${base}/${a.id}`} className="flex items-start gap-3 px-4 py-3 active:bg-stone-100">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{a.entry_name}</p>
                  <p className="truncate text-xs text-muted">
                    {(a.organizations as unknown as { name: string } | null)?.name}
                    {(a.parade_categories as unknown as { name: string } | null)?.name &&
                      ` · ${(a.parade_categories as unknown as { name: string }).name}`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {a.participant_count} people · {feet(a.footprint_length_ft)}
                    {a.submitted_at && ` · ${formatDateTime(a.submitted_at, event.timezone)}`}
                  </p>
                </div>
                <StatusBadge status={a.status as ApplicationStatus} />
              </Link>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-stone-50 text-xs text-muted uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Entry</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">People</th>
                <th className="px-3 py-2 text-right font-medium">Length</th>
                <th className="px-3 py-2 font-medium">Submitted</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {apps.map((a) => (
                <tr key={a.id} className="hover:bg-stone-50">
                  <td className="px-3 py-2">
                    <Link href={`${base}/${a.id}`} className="font-medium text-brand hover:underline">
                      {a.entry_name}
                    </Link>
                    <p className="text-xs text-muted">{(a.organizations as unknown as { name: string } | null)?.name}</p>
                  </td>
                  <td className="px-3 py-2">{(a.parade_categories as unknown as { name: string } | null)?.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.participant_count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{feet(a.footprint_length_ft)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(a.submitted_at, event.timezone)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={a.status as ApplicationStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <EmptyState>
          No applications{statuses.length ? ` with status ${statuses.map((s) => STATUS_LABELS[s]).join(" / ")}` : ""}.
        </EmptyState>
      )}
    </>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`shrink-0 rounded-full px-3 py-1 text-sm whitespace-nowrap ${active ? "bg-brand text-white" : "bg-stone-100 hover:bg-stone-200"}`}
    >
      {children}
    </Link>
  );
}
