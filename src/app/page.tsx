import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { photos } from "@/lib/images";
import { EmptyState } from "@/components/ui";

export default async function Home() {
  const supabase = await createClient();
  const { data: events } = await supabase
    .from("events")
    .select("slug, name, year, municipality, starts_at, status")
    .neq("status", "archived")
    .order("year", { ascending: false });

  const featured =
    events?.find((e) => e.slug === process.env.NEXT_PUBLIC_DEFAULT_EVENT_SLUG) ?? events?.[0] ?? null;

  return (
    <main>
      <section className="relative isolate overflow-hidden bg-black">
        <Image
          src={photos.headquarters.src}
          alt={photos.headquarters.alt}
          placeholder="blur"
          priority
          fill
          sizes="100vw"
          className="-z-10 object-cover object-center"
        />
        <div className="photo-scrim absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto flex min-h-[26rem] max-w-6xl flex-col justify-end px-4 py-10 text-white sm:min-h-[32rem]">
          <p className="text-sm font-semibold tracking-wide text-gold uppercase">Southport, North Carolina</p>
          <h1 className="mt-2 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            {featured ? `${featured.year} ${featured.name}` : "Southport Christmas Parade"}
          </h1>
          <p className="mt-3 max-w-xl text-white/85">
            Register an entry, follow the lineup on parade night, and get announcements. Spectators don&apos;t need
            an account.
          </p>
          {featured && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={`/events/${featured.slug}`}
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-semibold text-white hover:bg-red-800"
              >
                Lineup &amp; route
              </Link>
              {featured.status === "registration_open" && (
                <Link
                  href={`/events/${featured.slug}/register`}
                  className="inline-flex min-h-11 items-center rounded-md bg-white/95 px-5 font-semibold text-foreground hover:bg-white"
                >
                  Register an entry
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
      <div className="chevron-stripe h-2" aria-hidden />

      <div className="mx-auto max-w-6xl space-y-12 px-4 py-10">
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Events</h2>
          {events && events.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2">
              {events.map((e) => (
                <li key={e.slug}>
                  <Link
                    href={`/events/${e.slug}`}
                    className="block rounded-lg border border-border border-l-4 border-l-accent bg-surface p-5 transition hover:border-brand"
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
        </section>

        <section aria-labelledby="community">
          <h2 id="community" className="text-2xl font-semibold tracking-tight">
            A Southport tradition
          </h2>
          <p className="mt-1 max-w-2xl text-muted">
            Firefighters, families and neighbors gather at Fire Headquarters on Howe Street, where the parade
            finishes.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            {[photos.ladderRides, photos.families, photos.towerFamilies].map((p) => (
              <li key={p.alt} className="relative aspect-[4/3] overflow-hidden rounded-lg">
                <Image
                  src={p.src}
                  alt={p.alt}
                  placeholder="blur"
                  fill
                  sizes="(min-width: 640px) 33vw, 100vw"
                  className="object-cover transition duration-500 hover:scale-105"
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
