// Offline-tolerant field actions (§6): every marshal action gets a client id and
// is stored on the device until the server confirms it. The UI always shows
// whether an action is only on this device or synchronized.

export type QueuedKind = "check_in" | "check_in_token" | "set_status" | "checkpoint_pass";

export interface QueuedAction {
  id: string; // client_action_id, also the idempotency key on the server
  kind: QueuedKind;
  label: string;
  args: Record<string, unknown>;
  recordedAt: string;
  state: "pending" | "synced" | "conflict" | "rejected";
  message?: string;
  attempts: number;
}

export interface RpcResult {
  ok?: boolean;
  escalated?: boolean;
  reason?: string;
  duplicate?: boolean;
}

export type RpcCaller = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

const RPC: Record<QueuedKind, string> = {
  check_in: "check_in_unit_by_id",
  check_in_token: "check_in_unit",
  set_status: "set_unit_status",
  checkpoint_pass: "record_checkpoint_passage",
};

/** Network/transport failures leave the action pending; server decisions settle it. */
function isTransportError(error: { message: string; code?: string }) {
  return !error.code || /fetch|network|timeout|offline/i.test(error.message);
}

export async function syncAction(action: QueuedAction, call: RpcCaller): Promise<QueuedAction> {
  const args = { ...action.args, p_client_action_id: action.id, p_recorded_at: action.recordedAt };
  try {
    const { data, error } = await call(RPC[action.kind], args);
    if (error) {
      if (isTransportError(error)) return { ...action, attempts: action.attempts + 1, message: error.message };
      return { ...action, state: "rejected", message: error.message, attempts: action.attempts + 1 };
    }
    const r = (data ?? {}) as RpcResult;
    if (r.ok === false) {
      return {
        ...action,
        state: r.escalated ? "conflict" : "rejected",
        message: r.reason ?? "Not accepted",
        attempts: action.attempts + 1,
      };
    }
    return { ...action, state: r.escalated ? "conflict" : "synced", message: r.reason, attempts: action.attempts + 1 };
  } catch (e) {
    return { ...action, attempts: action.attempts + 1, message: e instanceof Error ? e.message : String(e) };
  }
}

export function storageKey(eventId: string) {
  return `parade-queue:${eventId}`;
}

export function loadQueue(eventId: string): QueuedAction[] {
  try {
    const raw = localStorage.getItem(storageKey(eventId));
    return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
  } catch {
    return [];
  }
}

export function saveQueue(eventId: string, queue: QueuedAction[]) {
  try {
    // Keep every unsynced action; trim old synced history.
    const unsynced = queue.filter((a) => a.state !== "synced");
    const synced = queue.filter((a) => a.state === "synced").slice(-100);
    localStorage.setItem(storageKey(eventId), JSON.stringify([...unsynced, ...synced]));
  } catch {
    // Storage unavailable (private mode). Actions still sync while the page is open.
  }
}

export function newAction(kind: QueuedKind, label: string, args: Record<string, unknown>): QueuedAction {
  return {
    id: crypto.randomUUID(),
    kind,
    label,
    args,
    recordedAt: new Date().toISOString(),
    state: "pending",
    attempts: 0,
  };
}
