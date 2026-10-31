import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { ButtonLink, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import type { ApplicationStatus } from "@/lib/domain/applications";

export const metadata: Metadata = { title: "My entries" };

export default async function MyEntries() {
  const user = await requireUser("/my");
  const supabase = await createClient();
  const [{ data: apps }, { data: openEvents }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, entry_name, status, updated_at, events(slug, name, year), organizations(name)")
      .eq("submitted_by", user.id)
      .order("updated_at", { ascending: false }),
    supabase.from("events").select("slug, name, year").eq("status", "registration_open").order("year"),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title="My parade entries"
        actions={openEvents?.map((e) => (
          <ButtonLink key={e.slug} href={`/events/${e.slug}/register`}>
            New entry: {e.year} {e.name}
          </ButtonLink>
        ))}
      />
      {apps && apps.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {apps.map((a) => {
            const ev = a.events as unknown as { name: string; year: number } | null;
            const org = a.organizations as unknown as { name: string } | null;
            return (
              <li key={a.id}>
                <Link href={`/my/applications/${a.id}`} className="flex items-center gap-3 p-4 hover:bg-stone-50">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.entry_name}</p>
                    <p className="text-sm text-muted">
                      {org?.name} · {ev?.year} {ev?.name} · updated {formatDateTime(a.updated_at)}
                    </p>
                  </div>
                  <StatusBadge status={a.status as ApplicationStatus} />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState>You haven&apos;t started any parade entries yet.</EmptyState>
      )}
    </main>
  );
}
