import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/data";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Marshal" };

export default async function MarshalHome() {
  const user = await requireUser("/marshal");
  const supabase = await createClient();
  const { data } = await supabase.from("event_roles").select("events(slug, name, year, status)").eq("user_id", user.id);
  const events = [
    ...new Map(
      (data ?? [])
        .map((r) => r.events as unknown as { slug: string; name: string; year: number; status: string })
        .filter((e) => e.status !== "archived")
        .map((e) => [e.slug, e]),
    ).values(),
  ];
  if (events.length === 1) redirect(`/marshal/${events[0].slug}`);
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <PageHeader title="Marshal" />
      {events.length === 0 ? (
        <EmptyState>You don&apos;t have a marshal role yet. Ask the Parade Director to add you.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => (
            <li key={e.slug}>
              <Link href={`/marshal/${e.slug}`} className="block rounded-lg border border-border bg-surface p-4 text-lg font-medium">
                {e.year} {e.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
