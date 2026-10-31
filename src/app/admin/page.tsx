import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/data";
import { ROLE_LABELS, type EventRole } from "@/lib/domain/roles";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Staff" };

export default async function AdminHome() {
  const user = await requireUser("/admin");
  const supabase = await createClient();
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("is_system_admin").eq("id", user.id).maybeSingle(),
    supabase.from("event_roles").select("role, events(slug, name, year)").eq("user_id", user.id),
  ]);

  const events = new Map<string, { slug: string; name: string; year: number; roles: string[] }>();
  for (const r of roles ?? []) {
    const e = r.events as unknown as { slug: string; name: string; year: number };
    const entry = events.get(e.slug) ?? { ...e, roles: [] };
    entry.roles.push(ROLE_LABELS[r.role as EventRole]);
    events.set(e.slug, entry);
  }
  if (profile?.is_system_admin) {
    const { data: all } = await supabase.from("events").select("slug, name, year").order("year", { ascending: false });
    for (const e of all ?? []) if (!events.has(e.slug)) events.set(e.slug, { ...e, roles: ["System Administrator"] });
  }

  const list = [...events.values()].sort((a, b) => b.year - a.year);
  if (list.length === 1) redirect(`/admin/${list[0].slug}`);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Staff workspace" subtitle="Choose an event." />
      {list.length === 0 ? (
        <EmptyState>
          Your account has no staff role yet. Ask the Parade Director to grant you access, then sign in again.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.map((e) => (
            <li key={e.slug}>
              <Link href={`/admin/${e.slug}`} className="block rounded-lg border border-border bg-surface p-4 hover:border-brand">
                <p className="font-semibold">
                  {e.year} {e.name}
                </p>
                <p className="text-sm text-muted">{e.roles.join(", ")}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
