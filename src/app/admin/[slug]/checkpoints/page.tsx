import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { EmptyState, PageHeader } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";

export default async function CheckpointsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await requireStaffEvent(slug);
  const supabase = await createClient();
  const [{ data: cps }, { data: units }, { data: moves }] = await Promise.all([
    supabase.from("checkpoints").select("id, code, name, sequence, field_validated").eq("event_id", event.id).order("sequence"),
    supabase
      .from("parade_units")
      .select("id, name, sequence_number, status")
      .eq("event_id", event.id)
      .not("sequence_number", "is", null)
      .order("sequence_number"),
    supabase.from("movement_events").select("unit_id, checkpoint_id, recorded_at, received_at").eq("event_id", event.id),
  ]);

  const at = new Map((moves ?? []).map((m) => [`${m.unit_id}:${m.checkpoint_id}`, m]));
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: event.timezone }).format(new Date(iso));

  return (
    <>
      <AutoRefresh seconds={20} />
      <PageHeader
        title="Checkpoints"
        subtitle="Marshal-reported passage times. Progress between checkpoints is not tracked."
        actions={
          <Link href={`/marshal/${slug}/checkpoint`} className="text-sm text-brand hover:underline">
            Open checkpoint marshal app →
          </Link>
        }
      />
      {!units?.length ? (
        <EmptyState>No units are in the lineup yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-stone-50 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {cps?.map((c) => (
                  <th key={c.id} className="px-3 py-2 font-medium whitespace-nowrap">
                    {c.name}
                    {!c.field_validated && <span title="Placement not field-validated"> *</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {units.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2 font-mono">{u.sequence_number}</td>
                  <td className="px-3 py-2">{u.name}</td>
                  <td className="px-3 py-2 text-xs text-muted">{u.status.replace(/_/g, " ")}</td>
                  {cps?.map((c) => {
                    const m = at.get(`${u.id}:${c.id}`);
                    const late = m && new Date(m.received_at).getTime() - new Date(m.recorded_at).getTime() > 60000;
                    return (
                      <td key={c.id} className="px-3 py-2 tabular-nums whitespace-nowrap">
                        {m ? (
                          <span title={late ? `Recorded offline, synced ${time(m.received_at)}` : undefined}>
                            {time(m.recorded_at)}
                            {late && <span className="text-amber-700"> ⟳</span>}
                          </span>
                        ) : (
                          <span className="text-muted">·</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">* placement not yet field-validated · ⟳ recorded offline and synchronized later</p>
    </>
  );
}
