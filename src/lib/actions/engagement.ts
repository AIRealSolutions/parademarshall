"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./result";

function done(error: { message: string } | null): ActionResult {
  if (error) return { error: error.message };
  revalidatePath("/events", "layout");
  revalidatePath("/admin", "layout");
  return { ok: true };
}

// --- Public ----------------------------------------------------------------------

export async function castVote(eventId: string, unitId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cast_vote", { p_event_id: eventId, p_unit_id: unitId });
  return done(error);
}

export async function recordPhotoSubmission(input: {
  event_id: string;
  storage_path: string;
  unit_id: string | null;
  caption: string;
  credit_name: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("photo_submissions").insert({
    event_id: input.event_id,
    storage_path: input.storage_path,
    unit_id: input.unit_id || null,
    caption: input.caption.trim().slice(0, 300) || null,
    credit_name: input.credit_name.trim().slice(0, 100) || null,
  });
  if (error) {
    // Don't leave an orphaned file behind if the record was refused.
    await supabase.storage.from("event-photos").remove([input.storage_path]);
  }
  return done(error);
}

// --- Staff ------------------------------------------------------------------------

const sponsorSchema = z.object({
  name: z.string().trim().min(1, "Sponsor name is required").max(160),
  tier: z.enum(["presenting", "gold", "silver", "community"]),
  website: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || /^https?:\/\//i.test(v), "Website must start with http:// or https://"),
  description: z.string().trim().max(1000),
  is_published: z.boolean(),
});

export async function saveSponsor(
  eventId: string,
  id: string | null,
  input: z.input<typeof sponsorSchema>,
): Promise<ActionResult> {
  const v = sponsorSchema.safeParse(input);
  if (!v.success) return { error: v.error.issues[0].message };
  const row = { ...v.data, website: v.data.website || null, description: v.data.description || null };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("sponsors").update(row).eq("id", id)
    : await supabase.from("sponsors").insert({ ...row, event_id: eventId });
  return done(error);
}

export async function deleteSponsor(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("sponsors").delete().eq("id", id);
  return done(error);
}

export async function setVoting(
  eventId: string,
  input: { opens_at: string | null; closes_at: string | null; results_published: boolean },
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update({
      voting_opens_at: input.opens_at,
      voting_closes_at: input.closes_at,
      voting_results_published: input.results_published,
    })
    .eq("id", eventId)
    .select("id");
  if (!error && !data?.length) return { error: "Only the Parade Director can change voting settings." };
  return done(error);
}

export async function moderatePhoto(id: string, status: "approved" | "rejected" | "pending"): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("photo_submissions").update({ status }).eq("id", id).select("id");
  if (!error && !data?.length) return { error: "Only the director or assistant director can moderate photos." };
  return done(error);
}
