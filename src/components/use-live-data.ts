"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Loads data with `load` and reloads it whenever one of `tables` changes for
 * the event (Supabase Realtime), falling back to polling when the realtime
 * connection is down.
 */
export function useLiveData<T>(eventId: string, tables: string[], load: () => Promise<T>, pollMs = 15000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const tableKey = tables.join(",");
  useEffect(() => {
    refresh();
    const supabase = createClient();
    const channel = supabase.channel(`live:${eventId}:${tableKey}`);
    for (const table of tableKey.split(",")) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: table === "events" ? `id=eq.${eventId}` : `event_id=eq.${eventId}` },
        () => {
          // Coalesce bursts of changes into one reload.
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(refresh, 250);
        },
      );
    }
    channel.subscribe((status) => setLive(status === "SUBSCRIBED"));
    const poll = setInterval(refresh, pollMs);
    return () => {
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [eventId, tableKey, pollMs, refresh]);

  return { data, error, live, updatedAt, refresh };
}
