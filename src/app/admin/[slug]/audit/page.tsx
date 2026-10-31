import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { isOverseer } from "@/lib/domain/roles";
import { AuditList, type AuditRow } from "@/components/audit-list";
import { Card, Notice, PageHeader } from "@/components/ui";

const TABLES = [
  "applications",
  "parade_units",
  "staging_assignments",
  "restrictions",
  "dispatch_authorizations",
  "event_roles",
  "events",
  "announcements",
  "publications",
];

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ table?: string }>;
}) {
  const { slug } = await params;
  const { table } = await searchParams;
  const { event, access } = await requireStaffEvent(slug);
  if (!isOverseer(access)) {
    return <Notice tone="warn">Audit history is available to the Parade Director, Assistant Director and Fire Chief.</Notice>;
  }

  const supabase = await createClient();
  let q = supabase
    .from("audit_logs")
    .select("id, created_at, action, table_name, context, actor_id, old_data, new_data, profiles:actor_id(full_name, email)")
    .eq("event_id", event.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (table && TABLES.includes(table)) q = q.eq("table_name", table);
  const { data, error } = await q.returns<AuditRow[]>();

  return (
    <>
      <PageHeader title="Audit History" subtitle="Most recent 200 changes. Records are written by the database and cannot be edited." />
      <form className="mb-4 flex gap-2">
        <label htmlFor="table" className="sr-only">
          Record type
        </label>
        <select id="table" name="table" defaultValue={table ?? ""} className="input w-64">
          <option value="">All record types</option>
          {TABLES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <button className="rounded-md border border-border bg-surface px-3 text-sm">Filter</button>
      </form>
      {error && <Notice tone="bad">{error.message}</Notice>}
      <Card>
        <AuditList rows={data ?? []} timezone={event.timezone} showTable />
      </Card>
    </>
  );
}
