import type { QueuedAction } from "@/lib/offline-queue";

const STYLE: Record<QueuedAction["state"], [string, string]> = {
  pending: ["Saved on this device", "bg-amber-100 text-amber-900"],
  synced: ["Synced", "bg-emerald-100 text-emerald-900"],
  conflict: ["Escalated to dispatch", "bg-rose-100 text-rose-900"],
  rejected: ["Not accepted", "bg-rose-100 text-rose-900"],
};

export function SyncBadge({ state }: { state: QueuedAction["state"] }) {
  const [label, cls] = STYLE[state];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>{label}</span>;
}

export function QueueList({ queue, onDismiss }: { queue: QueuedAction[]; onDismiss: (id: string) => void }) {
  const recent = [...queue].reverse().slice(0, 15);
  if (recent.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h2 className="mb-2 text-sm font-semibold">This device</h2>
      <ul className="space-y-2 text-sm">
        {recent.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{new Date(a.recordedAt).toLocaleTimeString()}</span>
            <span className="min-w-0 flex-1">{a.label}</span>
            <SyncBadge state={a.state} />
            {a.message && a.state !== "synced" && <span className="w-full text-xs text-accent">{a.message}</span>}
            {(a.state === "rejected" || a.state === "conflict") && (
              <button className="text-xs text-muted underline" onClick={() => onDismiss(a.id)}>
                Dismiss
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConnectionBar({ online, pending }: { online: boolean; pending: number }) {
  return (
    <div className={`rounded-md px-3 py-2 text-sm font-medium ${online ? "bg-emerald-50 text-emerald-900" : "bg-amber-100 text-amber-950"}`} role="status">
      {online ? "Online" : "Offline — actions are saved on this device"}
      {pending > 0 && ` · ${pending} waiting to sync`}
    </div>
  );
}
