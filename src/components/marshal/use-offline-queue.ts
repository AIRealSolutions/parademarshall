"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadQueue, newAction, saveQueue, syncAction, type QueuedAction, type QueuedKind, type RpcCaller } from "@/lib/offline-queue";

export function useOfflineQueue(eventId: string, onSynced?: () => void) {
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [online, setOnline] = useState(true);
  const queueRef = useRef<QueuedAction[]>([]);
  const syncing = useRef(false);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const update = useCallback(
    (next: QueuedAction[]) => {
      queueRef.current = next;
      setQueue(next);
      saveQueue(eventId, next);
    },
    [eventId],
  );

  const flush = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    const supabase = createClient();
    const call: RpcCaller = async (fn, args) => {
      const { data, error } = await supabase.rpc(fn, args);
      return { data, error: error ? { message: error.message, code: error.code } : null };
    };
    let changed = false;
    for (const a of queueRef.current.filter((x) => x.state === "pending")) {
      const r = await syncAction(a, call);
      if (r.state !== "pending") changed = true;
      update(queueRef.current.map((x) => (x.id === r.id ? r : x)));
      if (r.state === "pending") break; // still offline; keep order and retry later
    }
    syncing.current = false;
    if (changed) onSyncedRef.current?.();
  }, [update]);

  useEffect(() => {
    update(loadQueue(eventId));
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const t = setInterval(flush, 10000);
    flush();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(t);
    };
  }, [eventId, flush, update]);

  const enqueue = useCallback(
    (kind: QueuedKind, label: string, args: Record<string, unknown>) => {
      const a = newAction(kind, label, args);
      update([...queueRef.current, a]);
      flush();
      return a;
    },
    [flush, update],
  );

  const dismiss = useCallback((id: string) => update(queueRef.current.filter((x) => x.id !== id)), [update]);

  return { queue, online, enqueue, flush, dismiss, pending: queue.filter((a) => a.state === "pending").length };
}
