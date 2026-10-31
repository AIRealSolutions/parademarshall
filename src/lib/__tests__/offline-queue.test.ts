import { describe, expect, it } from "vitest";
import { newAction, syncAction, type RpcCaller } from "../offline-queue";

const action = () => newAction("checkpoint_pass", "Unit 1 at Moore", { p_unit_id: "u", p_checkpoint_id: "c" });

describe("syncAction", () => {
  it("marks confirmed actions synced and sends the idempotency key", async () => {
    let sent: Record<string, unknown> = {};
    const call: RpcCaller = async (_fn, args) => {
      sent = args;
      return { data: { ok: true }, error: null };
    };
    const a = action();
    const r = await syncAction(a, call);
    expect(r.state).toBe("synced");
    expect(sent.p_client_action_id).toBe(a.id);
    expect(sent.p_recorded_at).toBe(a.recordedAt);
  });

  it("keeps the action pending on network failure", async () => {
    const call: RpcCaller = async () => {
      throw new TypeError("Failed to fetch");
    };
    const r = await syncAction(action(), call);
    expect(r.state).toBe("pending");
    expect(r.attempts).toBe(1);
  });

  it("surfaces escalated conflicts for human resolution", async () => {
    const call: RpcCaller = async () => ({ data: { ok: false, escalated: true, reason: "Another unit" }, error: null });
    expect((await syncAction(action(), call)).state).toBe("conflict");
  });

  it("settles server refusals as rejected", async () => {
    const call: RpcCaller = async () => ({ data: null, error: { message: "Not permitted", code: "42501" } });
    expect((await syncAction(action(), call)).state).toBe("rejected");
  });
});
