"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fromLocalInput } from "@/lib/format";

export interface SettingsState {
  error?: string;
  ok?: boolean;
}

const STATUSES = ["draft", "registration_open", "registration_closed", "operational", "live", "completed", "archived"] as const;

const schema = z.object({
  name: z.string().trim().min(1).max(160),
  host_organization: z.string().trim().max(160),
  municipality: z.string().trim().max(160),
  status: z.enum(STATUSES),
  starts_at: z.string(),
  registration_opens_at: z.string(),
  registration_closes_at: z.string(),
  default_separation_ft: z.coerce.number().min(0).max(200),
  arrival_instructions: z.string().max(2000),
  accessible_viewing: z.string().max(2000),
});

export async function updateEventSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const eventId = String(formData.get("event_id") ?? "");
  const tz = String(formData.get("timezone") ?? "America/New_York");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: current } = await supabase.from("events").select("settings").eq("id", eventId).maybeSingle();
  const { data, error } = await supabase
    .from("events")
    .update({
      settings: {
        ...((current?.settings as Record<string, unknown>) ?? {}),
        arrival_instructions: v.arrival_instructions.trim(),
        accessible_viewing: v.accessible_viewing.trim(),
      },
      name: v.name,
      host_organization: v.host_organization || null,
      municipality: v.municipality || null,
      status: v.status,
      starts_at: fromLocalInput(v.starts_at, tz),
      registration_opens_at: fromLocalInput(v.registration_opens_at, tz),
      registration_closes_at: fromLocalInput(v.registration_closes_at, tz),
      default_separation_ft: v.default_separation_ft,
    })
    .eq("id", eventId)
    .select("slug");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only the Parade Director or a system administrator can change event settings." };

  revalidatePath(`/admin/${data[0].slug}`, "layout");
  revalidatePath(`/events/${data[0].slug}`);
  return { ok: true };
}
