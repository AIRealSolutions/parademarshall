"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLiveData } from "@/components/use-live-data";
import { useOfflineQueue } from "@/components/marshal/use-offline-queue";
import { ConnectionBar, QueueList, SyncBadge } from "@/components/marshal/sync-badge";
import { QrScanner } from "@/components/marshal/qr-scanner";

interface Unit {
  id: string;
  name: string;
  sequence_number: number | null;
  status: string;
  pass_token: string;
  location: string | null;
}

const NEXT_STEPS: Record<string, { to: string; label: string }[]> = {
  checked_in: [
    { to: "staged", label: "In position (staged)" },
    { to: "ready", label: "Ready to go" },
  ],
  staged: [{ to: "ready", label: "Ready to go" }],
  held: [{ to: "ready", label: "Ready to go" }],
  ready: [{ to: "staged", label: "Not ready — back to staged" }],
};

export function CheckInApp({ eventId }: { eventId: string }) {
  const [supabase] = useState(createClient);
  const [scanning, setScanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: units, refresh } = useLiveData<Unit[]>(eventId, ["parade_units", "staging_assignments"], async () => {
    const { data, error } = await supabase
      .from("parade_units")
      .select("id, name, sequence_number, status, pass_token, staging_assignments(status, start_offset_ft, staging_blocks(block_number, staging_lanes(lane_number, staging_zones(street_name))))")
      .eq("event_id", eventId)
      .neq("status", "withdrawn")
      .order("sequence_number", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((u) => {
      const a = (u.staging_assignments as unknown as {
        status: string;
        start_offset_ft: number;
        staging_blocks: { block_number: number; staging_lanes: { lane_number: number; staging_zones: { street_name: string } } };
      }[]).find((x) => x.status !== "released");
      return {
        id: u.id,
        name: u.name,
        sequence_number: u.sequence_number,
        status: u.status,
        pass_token: u.pass_token,
        location: a
          ? `${a.staging_blocks.staging_lanes.staging_zones.street_name} · lane ${a.staging_blocks.staging_lanes.lane_number} · block ${a.staging_blocks.block_number}`
          : null,
      };
    });
  });
  const { queue, online, enqueue, dismiss, pending } = useOfflineQueue(eventId, refresh);

  // Show the status the unit will have once this device's queued actions sync.
  const localStatus = useMemo(() => {
    const m = new Map<string, { status: string; state: string }>();
    for (const a of queue) {
      if (a.state === "rejected") continue;
      const id = (a.args.p_unit_id as string) ?? units?.find((u) => u.pass_token === a.args.p_pass_token)?.id;
      if (!id) continue;
      const status = a.kind === "set_status" ? (a.args.p_to as string) : "checked_in";
      m.set(id, { status, state: a.state });
    }
    return m;
  }, [queue, units]);

  const selected = units?.find((u) => u.id === selectedId) ?? null;
  const statusOf = (u: Unit) => (localStatus.get(u.id)?.state === "pending" ? localStatus.get(u.id)!.status : u.status);

  function onScan(token: string) {
    const u = units?.find((x) => x.pass_token === token);
    if (u) {
      setSelectedId(u.id);
      setScanMiss(null);
      setScanning(false);
    } else if (!units) {
      // Unit list not loaded (offline from the start): record the scan for sync.
      enqueue("check_in_token", `Pass …${token.slice(-6)} checked in`, { p_pass_token: token });
      setScanning(false);
    } else {
      setScanMiss("Pass not recognized for this event.");
    }
  }

  const filtered = (units ?? []).filter((u) => `${u.sequence_number ?? ""} ${u.name}`.toLowerCase().includes(search.toLowerCase()));
  const counts = (units ?? []).reduce<Record<string, number>>((acc, u) => ((acc[statusOf(u)] = (acc[statusOf(u)] ?? 0) + 1), acc), {});

  return (
    <div className="space-y-3">
      <ConnectionBar online={online} pending={pending} />

      {selected ? (
        <section className="space-y-3 rounded-xl border-2 border-brand bg-surface p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm text-muted">{selected.sequence_number ? `Lineup #${selected.sequence_number}` : "No lineup position"}</p>
              <p className="text-2xl font-semibold">{selected.name}</p>
              <p className="mt-1 text-sm">{selected.location ?? "No approved staging location"}</p>
            </div>
            <button className="text-sm text-muted underline" onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>
          <p className="text-sm">
            Status: <strong>{statusOf(selected).replace(/_/g, " ")}</strong>{" "}
            {localStatus.get(selected.id) && <SyncBadge state={localStatus.get(selected.id)!.state as never} />}
          </p>
          <div className="grid gap-2">
            {statusOf(selected) === "not_arrived" && (
              <button
                className="min-h-16 rounded-lg bg-brand text-xl font-semibold text-white active:bg-brand-strong"
                onClick={() => enqueue("check_in", `${selected.name} checked in`, { p_unit_id: selected.id })}
              >
                Verify &amp; check in
              </button>
            )}
            {(NEXT_STEPS[statusOf(selected)] ?? []).map((s) => (
              <button
                key={s.to}
                className="min-h-14 rounded-lg border-2 border-brand text-lg font-semibold text-brand active:bg-brand/10"
                onClick={() => enqueue("set_status", `${selected.name} → ${s.to}`, { p_unit_id: selected.id, p_to: s.to, p_reason: null })}
              >
                {s.label}
              </button>
            ))}
            {["not_arrived", "checked_in", "staged", "ready"].includes(statusOf(selected)) && (
              <button
                className="min-h-12 rounded-lg border border-accent text-accent"
                onClick={() => {
                  const r = window.prompt(`Hold ${selected.name}: reason?`);
                  if (r?.trim()) enqueue("set_status", `${selected.name} held`, { p_unit_id: selected.id, p_to: "held", p_reason: r.trim() });
                }}
              >
                Hold unit
              </button>
            )}
          </div>
        </section>
      ) : scanning ? (
        <QrScanner onScan={onScan} onClose={() => setScanning(false)} />
      ) : (
        <button className="min-h-20 w-full rounded-xl bg-brand text-2xl font-semibold text-white active:bg-brand-strong" onClick={() => setScanning(true)}>
          Scan pass
        </button>
      )}
      {scanMiss && <p className="text-sm font-medium text-accent">{scanMiss}</p>}

      <section className="rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border p-2">
          <input className="input" placeholder="Find unit by name or number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find unit" />
        </div>
        <p className="px-3 pt-2 text-xs text-muted">
          {counts.not_arrived ?? 0} not arrived · {(counts.checked_in ?? 0) + (counts.staged ?? 0)} here · {counts.ready ?? 0} ready
        </p>
        <ul className="divide-y divide-border">
          {filtered.map((u) => (
            <li key={u.id}>
              <button className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-stone-100" onClick={() => setSelectedId(u.id)}>
                <span className="w-9 font-mono text-sm text-muted">{u.sequence_number ?? "—"}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{u.name}</span>
                <span className="text-xs text-muted">{statusOf(u).replace(/_/g, " ")}</span>
              </button>
            </li>
          ))}
          {!units && <li className="p-3 text-sm text-muted">Loading units…</li>}
        </ul>
      </section>

      <QueueList queue={queue} onDismiss={dismiss} />
    </div>
  );
}
