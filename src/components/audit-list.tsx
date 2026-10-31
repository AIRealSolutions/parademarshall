import { formatDateTime } from "@/lib/format";

export interface AuditRow {
  id: number;
  created_at: string;
  action: string;
  table_name: string;
  context: string | null;
  actor_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  profiles: { full_name: string | null; email: string | null } | null;
}

const IGNORED = new Set(["updated_at", "created_at"]);

export function changedFields(row: AuditRow): string[] {
  if (!row.old_data || !row.new_data) return [];
  return Object.keys(row.new_data).filter(
    (k) => !IGNORED.has(k) && JSON.stringify(row.old_data?.[k]) !== JSON.stringify(row.new_data?.[k]),
  );
}

export function AuditList({ rows, timezone, showTable }: { rows: AuditRow[]; timezone: string; showTable?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No recorded changes.</p>;
  return (
    <ol className="space-y-3 text-sm">
      {rows.map((r) => {
        const fields = changedFields(r);
        const actor = r.profiles?.full_name || r.profiles?.email || (r.actor_id ? "Unknown user" : "System");
        return (
          <li key={r.id} className="border-l-2 border-border pl-3">
            <p>
              <span className="font-medium">{actor}</span>{" "}
              <span className="text-muted">
                {r.context ?? `${r.action}${showTable ? ` ${r.table_name.replace(/_/g, " ")}` : ""}`}
              </span>
            </p>
            {fields.length > 0 && <p className="text-xs text-muted">Changed: {fields.join(", ").replace(/_/g, " ")}</p>}
            <p className="text-xs text-muted">{formatDateTime(r.created_at, timezone)}</p>
          </li>
        );
      })}
    </ol>
  );
}
