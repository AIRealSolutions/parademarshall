"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/domain/applications";

export interface TransitionState {
  error?: string;
  ok?: boolean;
}

/** Calls the authoritative transition_application() RPC. Used by participant and staff screens. */
export async function transitionApplication(_prev: TransitionState, formData: FormData): Promise<TransitionState> {
  const id = String(formData.get("application_id") ?? "");
  const to = String(formData.get("to") ?? "") as ApplicationStatus;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!APPLICATION_STATUSES.includes(to)) return { error: "Unknown status." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_application", {
    p_application_id: id,
    p_to: to,
    p_note: note,
  });
  if (error) return { error: error.message };

  revalidatePath("/my", "layout");
  revalidatePath("/admin", "layout");
  return { ok: true };
}
