"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  applicationSchema,
  fieldErrors,
  organizationSchema,
  vehicleSchema,
} from "@/lib/domain/registration";

export interface SaveState {
  errors?: Record<string, string>;
  message?: string;
}

const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true";

export async function saveApplication(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { message: "Your session expired. Sign in again to continue." };

  const intent = formData.get("intent") === "submit" ? "submit" : "draft";
  const eventId = String(formData.get("event_id") ?? "");
  const applicationId = String(formData.get("application_id") ?? "") || null;
  const orgChoice = String(formData.get("organization_id") ?? "new");

  const app = applicationSchema.safeParse({
    entry_name: formData.get("entry_name"),
    category_id: formData.get("category_id"),
    purpose: formData.get("purpose") ?? undefined,
    responsible_contact_name: formData.get("responsible_contact_name"),
    responsible_contact_phone: formData.get("responsible_contact_phone"),
    responsible_contact_email: formData.get("responsible_contact_email"),
    participant_count: formData.get("participant_count") || 0,
    footprint_length_ft: formData.get("footprint_length_ft") || 0,
    footprint_width_ft: formData.get("footprint_width_ft") || 0,
    has_animals: bool(formData.get("has_animals")),
    has_amplified_sound: bool(formData.get("has_amplified_sound")),
    safety_requirements: formData.get("safety_requirements") ?? undefined,
    accessibility_needs: formData.get("accessibility_needs") ?? undefined,
    public_name: formData.get("public_name") ?? undefined,
    public_description: formData.get("public_description") ?? undefined,
  });

  let vehiclesRaw: unknown = [];
  try {
    vehiclesRaw = JSON.parse(String(formData.get("vehicles") ?? "[]"));
  } catch {
    return { message: "Vehicle details could not be read. Please re-enter them." };
  }
  const vehicles = z.array(vehicleSchema).max(25).safeParse(vehiclesRaw);

  const org =
    orgChoice === "new"
      ? organizationSchema.safeParse({
          name: formData.get("org_name"),
          contact_name: formData.get("org_contact_name") ?? undefined,
          contact_email: formData.get("org_contact_email") ?? "",
          contact_phone: formData.get("org_contact_phone") ?? undefined,
          mailing_address: formData.get("org_mailing_address") ?? undefined,
          website: formData.get("org_website") ?? undefined,
        })
      : null;

  const waiverId = String(formData.get("waiver_id") ?? "") || null;
  const waiverAccepted = bool(formData.get("waiver_accepted"));
  const waiverName = String(formData.get("waiver_accepted_name") ?? "").trim();

  const errors: Record<string, string> = {
    ...(app.success ? {} : fieldErrors(app.error)),
    ...(vehicles.success ? {} : fieldErrors(vehicles.error, "vehicles.")),
    ...(org && !org.success ? fieldErrors(org.error, "org_") : {}),
  };
  if (intent === "submit" && waiverId && (!waiverAccepted || !waiverName)) {
    errors.waiver_accepted = "Accept the acknowledgment and type your full name to submit.";
  }
  if (Object.keys(errors).length > 0 || !app.success || !vehicles.success) {
    return { errors, message: "Please correct the highlighted fields." };
  }

  let organizationId = orgChoice;
  if (org?.success) {
    const { data, error } = await supabase
      .from("organizations")
      .insert({ ...org.data, contact_email: org.data.contact_email || null, created_by: user.id })
      .select("id")
      .single();
    if (error) return { message: `Could not save organization: ${error.message}` };
    organizationId = data.id;
  }

  const record = {
    ...app.data,
    organization_id: organizationId,
    ...(waiverAccepted && waiverName
      ? { waiver_id: waiverId, waiver_accepted_at: new Date().toISOString(), waiver_accepted_name: waiverName }
      : {}),
  };

  let id = applicationId;
  if (id) {
    const { error } = await supabase.from("applications").update(record).eq("id", id);
    if (error) return { message: `Could not save entry: ${error.message}` };
  } else {
    const { data, error } = await supabase
      .from("applications")
      .insert({ ...record, event_id: eventId, submitted_by: user.id })
      .select("id")
      .single();
    if (error) return { message: `Could not save entry: ${error.message}` };
    id = data.id;
  }

  // Vehicles are replaced as a set while the entry is editable.
  const { error: delError } = await supabase.from("vehicles").delete().eq("application_id", id);
  if (delError) return { message: `Could not save vehicles: ${delError.message}` };
  if (vehicles.data.length > 0) {
    const { error } = await supabase
      .from("vehicles")
      .insert(vehicles.data.map((v) => ({ ...v, application_id: id })));
    if (error) return { message: `Could not save vehicles: ${error.message}` };
  }

  if (intent === "submit") {
    const { error } = await supabase.rpc("transition_application", {
      p_application_id: id,
      p_to: "submitted",
      p_note: null,
    });
    if (error) {
      revalidatePath("/my");
      return { message: `Your draft was saved, but it could not be submitted: ${error.message}` };
    }
  }

  revalidatePath("/my");
  redirect(`/my/applications/${id}?saved=${intent}`);
}
