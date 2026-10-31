"use server";

// Staff operations. Every call runs as the signed-in user, so Row Level
// Security and the workflow functions decide what is permitted; these
// actions only shape input and refresh the affected pages.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./result";

type DbError = { message: string } | null;

function done<T>(error: DbError, data?: T): ActionResult<T> {
  if (error) return { error: error.message };
  revalidatePath("/admin", "layout");
  revalidatePath("/marshal", "layout");
  return { ok: true, data };
}

const uuid = z.string().uuid();
const feet = z.coerce.number().min(0).max(5000);

// --- Staging (FR-03) ---------------------------------------------------------

export async function assignUnit(input: {
  event_id: string;
  unit_id: string;
  block_id: string;
  start_offset_ft: number;
  occupied_length_ft: number;
  override_reason?: string;
}): Promise<ActionResult> {
  const v = z
    .object({
      event_id: uuid,
      unit_id: uuid,
      block_id: uuid,
      start_offset_ft: feet,
      occupied_length_ft: feet.refine((n) => n > 0, "Occupied length must be positive"),
      override_reason: z.string().trim().max(500).optional(),
    })
    .safeParse(input);
  if (!v.success) return { error: v.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("staging_assignments").insert({
    ...v.data,
    override_reason: v.data.override_reason || null,
  });
  return done(error);
}

export async function moveAssignment(input: {
  id: string;
  block_id: string;
  start_offset_ft: number;
  occupied_length_ft: number;
  override_reason?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  // Moving returns the placement to "proposed" so it needs approval again.
  const { error } = await supabase
    .from("staging_assignments")
    .update({
      block_id: input.block_id,
      start_offset_ft: input.start_offset_ft,
      occupied_length_ft: input.occupied_length_ft,
      override_reason: input.override_reason || null,
      status: "proposed",
      flag_reason: null,
    })
    .eq("id", input.id);
  return done(error);
}

export async function approveAssignment(id: string, overrideReason?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_staging_assignment", {
    p_assignment_id: id,
    p_override_reason: overrideReason || null,
  });
  return done(error);
}

export async function releaseAssignment(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("staging_assignments").update({ status: "released" }).eq("id", id);
  return done(error);
}

export async function updateBlock(input: {
  id: string;
  usable_length_ft: number;
  permitted_width_ft: number;
  base_status: string;
  accessibility_notes: string;
  turning_notes: string;
}): Promise<ActionResult> {
  const v = z
    .object({
      id: uuid,
      usable_length_ft: z.coerce.number().positive().max(5000),
      permitted_width_ft: z.coerce.number().positive().max(100),
      base_status: z.enum(["open", "restricted", "temporarily_closed", "unavailable"]),
      accessibility_notes: z.string().max(1000),
      turning_notes: z.string().max(1000),
    })
    .safeParse(input);
  if (!v.success) return { error: v.error.issues[0].message };
  const { id, ...rest } = v.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("staging_blocks")
    .update({ ...rest, accessibility_notes: rest.accessibility_notes || null, turning_notes: rest.turning_notes || null })
    .eq("id", id);
  return done(error);
}

export async function addBlock(laneId: string, usableLengthFt: number, permittedWidthFt: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("staging_blocks")
    .select("block_number")
    .eq("lane_id", laneId)
    .order("block_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from("staging_blocks").insert({
    lane_id: laneId,
    block_number: (last?.block_number ?? 0) + 1,
    usable_length_ft: usableLengthFt,
    permitted_width_ft: permittedWidthFt,
  });
  return done(error);
}

export async function updateLane(input: { id: string; direction: string; width_ft: number }): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("staging_lanes")
    .update({ direction: input.direction, width_ft: input.width_ft })
    .eq("id", input.id);
  return done(error);
}

export async function updateGeometry(
  kind: "zone" | "lane" | "block" | "route_segment" | "checkpoint",
  id: string,
  geojson: object | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_geometry", { p_kind: kind, p_id: id, p_geojson: geojson });
  return done(error);
}

export async function markFieldValidated(table: "staging_zones" | "route_segments" | "checkpoints", id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from(table).update({ field_validated: true }).eq("id", id);
  return done(error);
}

export async function approvePlan(eventId: string, kind: "staging" | "route", notes: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_config", { p_event_id: eventId, p_kind: kind, p_notes: notes || null });
  return done(error);
}

export async function sendArrivalInstructions(eventId: string): Promise<ActionResult<number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("queue_assignment_instructions", { p_event_id: eventId });
  return done(error, data as number);
}

// --- Restrictions (FR-04) ----------------------------------------------------

export async function createRestriction(input: {
  event_id: string;
  target: "zone" | "lane" | "block";
  target_id: string;
  status: string;
  reason: string;
  responsible_authority: string;
  is_safety: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
}): Promise<ActionResult> {
  const v = z
    .object({
      event_id: uuid,
      target: z.enum(["zone", "lane", "block"]),
      target_id: uuid,
      status: z.enum(["restricted", "temporarily_closed", "unavailable"]),
      reason: z.string().trim().min(1, "A reason is required").max(1000),
      responsible_authority: z.string().trim().min(1, "Name the responsible authority").max(200),
      is_safety: z.boolean(),
      effective_from: z.string().nullish(),
      effective_to: z.string().nullish(),
    })
    .safeParse(input);
  if (!v.success) return { error: v.error.issues[0].message };
  const d = v.data;
  const supabase = await createClient();
  const { error } = await supabase.from("restrictions").insert({
    event_id: d.event_id,
    [`${d.target}_id`]: d.target_id,
    status: d.status,
    reason: d.reason,
    responsible_authority: d.responsible_authority,
    is_safety: d.is_safety,
    ...(d.effective_from ? { effective_from: d.effective_from } : {}),
    effective_to: d.effective_to || null,
  });
  return done(error);
}

export async function endRestriction(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("restrictions")
    .update({ effective_to: new Date().toISOString() })
    .eq("id", id);
  return done(error);
}

// --- Units & lineup (FR-02, FR-05) -----------------------------------------------

export async function splitUnit(unitId: string, name: string, vehicleIds: string[]): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("split_unit", { p_unit_id: unitId, p_new_name: name, p_vehicle_ids: vehicleIds });
  return done(error);
}

export async function updateUnit(input: {
  id: string;
  name: string;
  group_label: string;
  is_emergency_apparatus: boolean;
  public_visible: boolean;
  notes: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("parade_units")
    .update({
      name: input.name.trim(),
      group_label: input.group_label.trim() || null,
      is_emergency_apparatus: input.is_emergency_apparatus,
      public_visible: input.public_visible,
      notes: input.notes.trim() || null,
    })
    .eq("id", input.id);
  return done(error);
}

export async function reissuePass(unitId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reissue_unit_pass", { p_unit_id: unitId });
  return done(error);
}

export async function saveLineup(eventId: string, unitIds: string[], finalUnitId: string | null): Promise<ActionResult<number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_lineup", { p_event_id: eventId, p_unit_ids: unitIds });
  if (error) return { error: error.message };
  // One final unit per event: clear the old designation before setting the new one.
  const { error: clearErr } = await supabase
    .from("parade_units")
    .update({ is_final_unit: false })
    .eq("event_id", eventId)
    .eq("is_final_unit", true);
  if (clearErr) return { error: clearErr.message };
  if (finalUnitId) {
    const { error: finalErr } = await supabase.from("parade_units").update({ is_final_unit: true }).eq("id", finalUnitId);
    if (finalErr) return { error: finalErr.message };
  }
  return done(null, data as number);
}

export async function publishPublicPlan(eventId: string, notes: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_public_plan", { p_event_id: eventId, p_notes: notes || null });
  if (!error) revalidatePath("/events", "layout");
  return done(error);
}

// --- Safety (FR-09) ------------------------------------------------------------

export async function reportIncident(input: {
  event_id: string;
  summary: string;
  details: string;
  severity: string;
  unit_id: string | null;
  checkpoint_id: string | null;
  location_description: string;
}): Promise<ActionResult> {
  const v = z
    .object({
      event_id: uuid,
      summary: z.string().trim().min(1, "Summarize the incident").max(300),
      details: z.string().max(4000),
      severity: z.enum(["low", "moderate", "high", "critical"]),
      unit_id: uuid.nullable(),
      checkpoint_id: uuid.nullable(),
      location_description: z.string().max(300),
    })
    .safeParse(input);
  if (!v.success) return { error: v.error.issues[0].message };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("incidents").insert({
    ...v.data,
    details: v.data.details || null,
    location_description: v.data.location_description || null,
    reported_by: user?.id,
  });
  return done(error);
}

export async function updateIncident(id: string, status: string, resolution: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("incidents")
    .update({
      status,
      resolution: resolution.trim() || null,
      resolved_at: status === "resolved" || status === "closed" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  return done(error);
}

export async function setParadeHold(eventId: string, hold: boolean, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_parade_hold", { p_event_id: eventId, p_hold: hold, p_reason: reason || null });
  return done(error);
}

// --- Communications (FR-09) -------------------------------------------------------

export async function createAnnouncement(input: {
  event_id: string;
  audience: string;
  title: string;
  body: string;
  is_emergency: boolean;
  publish: boolean;
  expires_at: string | null;
}): Promise<ActionResult> {
  const v = z
    .object({
      event_id: uuid,
      audience: z.enum(["public", "participants", "staff"]),
      title: z.string().trim().min(1, "A title is required").max(200),
      body: z.string().trim().min(1, "A message is required").max(4000),
      is_emergency: z.boolean(),
      publish: z.boolean(),
      expires_at: z.string().nullable(),
    })
    .safeParse(input);
  if (!v.success) return { error: v.error.issues[0].message };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { publish, ...rest } = v.data;
  const { error } = await supabase.from("announcements").insert({
    ...rest,
    issued_by: user?.id,
    published_at: publish ? new Date().toISOString() : null,
  });
  return done(error);
}

export async function setAnnouncementPublished(id: string, published: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("announcements")
    .update(published ? { published_at: now, expires_at: null } : { expires_at: now })
    .eq("id", id);
  if (!error) revalidatePath("/events", "layout");
  return done(error);
}

// --- Staff & volunteers --------------------------------------------------------------

export async function grantRole(eventId: string, email: string, role: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_event_role", { p_event_id: eventId, p_email: email, p_role: role });
  return done(error);
}

export async function revokeRole(roleId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("event_roles").delete().eq("id", roleId);
  return done(error);
}

export async function addVolunteerAssignment(input: {
  event_id: string;
  user_id: string;
  position: string;
  checkpoint_id: string | null;
  zone_id: string | null;
  shift_start: string | null;
  shift_end: string | null;
  notes: string;
}): Promise<ActionResult> {
  if (!input.position.trim()) return { error: "Describe the position." };
  const supabase = await createClient();
  const { error } = await supabase.from("volunteer_assignments").insert({ ...input, notes: input.notes || null });
  return done(error);
}

export async function removeVolunteerAssignment(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("volunteer_assignments").delete().eq("id", id);
  return done(error);
}

// --- Event configuration (FR-01) ------------------------------------------------------

export async function addCategory(eventId: string, name: string): Promise<ActionResult> {
  if (!name.trim()) return { error: "Enter a category name." };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("parade_categories")
    .select("sort_order")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("parade_categories")
    .insert({ event_id: eventId, name: name.trim(), sort_order: (last?.sort_order ?? 0) + 10 });
  return done(error);
}

export async function setCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("parade_categories").update({ is_active: active }).eq("id", id);
  return done(error);
}

export async function cloneEvent(sourceId: string, slug: string, name: string, year: number): Promise<ActionResult<string>> {
  const v = z
    .object({ slug: z.string().regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes"), name: z.string().trim().min(1), year: z.number().int().min(2000).max(2200) })
    .safeParse({ slug, name, year });
  if (!v.success) return { error: v.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clone_event", {
    p_source_event_id: sourceId,
    p_slug: v.data.slug,
    p_name: v.data.name,
    p_year: v.data.year,
  });
  return done(error, (data as { slug: string } | null)?.slug);
}

export async function resolveConflict(dispatchEventId: string, note: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_dispatch_conflict", { p_dispatch_event_id: dispatchEventId, p_note: note });
  return done(error);
}
