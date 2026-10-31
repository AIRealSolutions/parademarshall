import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { EmptyState } from "@/components/ui";

export default async function Home() {
  const supabase = await createClient();
  const { data: events } = await supabase
    .from("events")
    .select("slug, name, year, municipality, starts_at, status")
    .neq("status", "archived")
    .order("year", { ascending: false });

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <section className="mb-10 max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Community parades, organized.</h1>
        <p className="mt-3 text-muted">
          Register an entry, follow the lineup, and get event announcements. Spectators don&apos;t need an
          account.
        </p>
      </section>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Events</h2>
      {events && events.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {events.map((e) => (
            <li key={e.slug}>
              <Link
                href={`/events/${e.slug}`}
                className="block rounded-lg border border-border bg-surface p-5 transition hover:border-brand"
              >
                <p className="text-lg font-semibold">
                  {e.year} {e.name}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {e.municipality}
                  {e.starts_at ? ` · ${formatDate(e.starts_at)}` : " · Date to be announced"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No upcoming events have been announced yet.</EmptyState>
      )}
    </main>
  );
}
