import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EventRow } from "@/lib/data";
import type { FormOptions } from "@/components/application-form";

export async function loadFormOptions(event: EventRow, userId: string): Promise<FormOptions> {
  const supabase = await createClient();
  const [{ data: categories }, { data: waivers }, { data: memberships }] = await Promise.all([
    supabase
      .from("parade_categories")
      .select("id, name")
      .eq("event_id", event.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("waivers")
      .select("id, title, body, version")
      .eq("event_id", event.id)
      .eq("is_active", true)
      .eq("is_required", true)
      .order("version", { ascending: false })
      .limit(1),
    supabase.from("organization_members").select("organizations(id, name)").eq("user_id", userId),
  ]);

  const organizations = (memberships ?? [])
    .map((m) => m.organizations as unknown as { id: string; name: string } | null)
    .filter((o): o is { id: string; name: string } => !!o)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    eventId: event.id,
    separationFt: Number(event.default_separation_ft),
    categories: categories ?? [],
    organizations,
    waiver: waivers?.[0] ?? null,
  };
}
