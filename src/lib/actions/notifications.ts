"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deliverPending } from "@/lib/notifications/deliver";
import type { ActionResult } from "./result";

export async function deliverNow(eventId: string): Promise<ActionResult<{ sent: number; failed: number; skipped: number }>> {
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("is_event_director", { p_event_id: eventId });
  if (!allowed) return { error: "Only the director or assistant director can send notifications." };
  const r = await deliverPending(eventId);
  if ("error" in r && r.error) return { error: r.error };
  revalidatePath("/admin", "layout");
  return { ok: true, data: r };
}
