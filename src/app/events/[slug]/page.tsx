import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { getEventBySlug, getUser, registrationOpen, votingOpen } from "@/lib/data";
import { signedPhotoUrls } from "@/lib/photos";
import { PublicLineup } from "@/components/public/public-lineup";
import { formatDate, formatDateTime } from "@/lib/format";
import { ButtonLink, Card, EmptyState, Notice } from "@/components/ui";
import { ParadeMap } from "@/components/map";
import { AutoRefresh } from "@/components/auto-refresh";
import type { GeoLine, GeoPoint } from "@/lib/domain/staging";

interface LineupItem {
  unit_id: string;
  sequence: number;
  name: string;
  category: string | null;
  description: string | null;
}

interface Publication {
  version: number;
  published_at: string;
  lineup: LineupItem[];
  route: { sequence: number; name: string; geometry: GeoLine }[];
  checkpoints: { code: string; name: string; sequence: number; geometry: GeoPoint }[];
}

interface Progress {
  unit_id: string;
  phase: "staging" | "on_route" | "finished" | "not_participating";
  last_checkpoint_name: string | null;
  last_reported_at: string | null;
}

const TIER_LABEL: Record<string, string> = {
  presenting: "Presenting sponsor",
  gold: "Gold",
  silver: "Silver",
  community: "Community",
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const event = await getEventBySlug((await params).slug);
  return { title: event ? `${event.year} ${event.name}` : "Event" };
}

export default async function EventPortal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const supabase = await createClient();
  const user = await getUser();
  const open = votingOpen(event);
  const [
    { data: announcements },
    { data: publication },
    { data: progress },
    { data: sponsors },
    { data: photos },
    { data: myVote },
    { data: results },
  ] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, body, is_emergency, published_at")
      .eq("event_id", event.id)
      .eq("audience", "public")
      .order("published_at", { ascending: false })
      .limit(10),
    supabase.rpc("latest_publication", { p_event_slug: slug }),
    supabase.rpc("public_progress", { p_event_slug: slug }),
    supabase
      .from("sponsors")
      .select("id, name, tier, website, description")
      .eq("event_id", event.id)
      .eq("is_published", true)
      .order("sort_order"),
    supabase
      .from("photo_submissions")
      .select("id, storage_path, caption, credit_name")
      .eq("event_id", event.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(8),
    user && open
      ? supabase.from("votes").select("unit_id").eq("event_id", event.id).maybeSingle()
      : Promise.resolve({ data: null }),
    event.voting_results_published
      ? supabase.rpc("vote_results", { p_event_id: event.id })
      : Promise.resolve({ data: null }),
  ]);
  const photoUrls = await signedPhotoUrls((photos ?? []).map((p) => p.storage_path));
  const topResults = ((results as { unit_id: string; unit_name: string; votes: number }[] | null) ?? []).slice(0, 3);

  const pub = publication as Publication | null;
  const progressByUnit = new Map(((progress as Progress[] | null) ?? []).map((p) => [p.unit_id, p]));
  const settings = event.settings as Record<string, string | boolean | undefined>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {(event.status === "live" || event.parade_hold) && <AutoRefresh seconds={30} />}
      <header className="space-y-2">
        <p className="text-sm font-medium text-brand">{event.municipality}</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {event.year} {event.name}
        </h1>
        <p className="text-muted">
          {event.starts_at ? formatDateTime(event.starts_at, event.timezone) : "Date and time to be announced"}
        </p>
        {registrationOpen(event) && (
          <div className="pt-2">
            <ButtonLink href={`/events/${slug}/register`}>Register a parade entry</ButtonLink>
          </div>
        )}
      </header>

      {event.parade_hold && (
        <Notice tone="warn">The parade is temporarily paused. Please follow instructions from event staff.</Notice>
      )}

      {announcements?.map((a) => (
        <Notice key={a.id} tone={a.is_emergency ? "bad" : "info"}>
          <p className="font-semibold">{a.title}</p>
          <p className="mt-1 whitespace-pre-line">{a.body}</p>
          <p className="mt-1 text-xs opacity-75">{formatDateTime(a.published_at, event.timezone)}</p>
        </Notice>
      ))}

      {pub && pub.route.length > 0 && (
        <section aria-label="Route map">
          <ParadeMap
            route={pub.route.map((r) => ({ name: r.name, geometry: r.geometry }))}
            checkpoints={pub.checkpoints.map((c) => ({ code: c.code, name: c.name, geometry: c.geometry, is_finish: c.sequence === pub.checkpoints.length }))}
            className="h-72 sm:h-96"
          />
          <p className="mt-1 text-xs text-muted">Blue line: parade route. Dots: checkpoints, finish in red.</p>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card
            title="Lineup"
            actions={pub && <span className="text-xs text-muted">Updated {formatDate(pub.published_at)}</span>}
          >
            {pub && pub.lineup.length > 0 ? (
              <>
                {progressByUnit.size > 0 && (
                  <p className="mb-3 text-xs text-muted">
                    Progress is approximate, based on reports from checkpoint volunteers. It is not live GPS
                    tracking.
                  </p>
                )}
                <PublicLineup
                  slug={slug}
                  eventId={event.id}
                  votingOpen={open}
                  signedIn={Boolean(user)}
                  myVote={(myVote as { unit_id: string } | null)?.unit_id ?? null}
                  units={pub.lineup.map((u) => {
                    const p = progressByUnit.get(u.unit_id);
                    return { ...u, phase: p?.phase, near: p?.last_checkpoint_name ?? null };
                  })}
                />
              </>
            ) : (
              <EmptyState>The lineup will be published closer to parade day.</EmptyState>
            )}
          </Card>
        </div>
        <Card title="Route">
          <dl className="space-y-3 text-sm">
            {settings.start && (
              <div>
                <dt className="text-xs text-muted uppercase">Start</dt>
                <dd>{String(settings.start)}</dd>
              </div>
            )}
            {settings.direction && (
              <div>
                <dt className="text-xs text-muted uppercase">Direction</dt>
                <dd>{String(settings.direction)}</dd>
              </div>
            )}
            {settings.finish && (
              <div>
                <dt className="text-xs text-muted uppercase">Finish</dt>
                <dd>{String(settings.finish)}</dd>
              </div>
            )}
          </dl>
          {pub && pub.checkpoints.length > 0 && (
            <ol className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
              {pub.checkpoints.map((c) => (
                <li key={c.code}>
                  {c.sequence}. {c.name}
                </li>
              ))}
            </ol>
          )}
          {settings.accessible_viewing && (
            <div className="mt-4 border-t border-border pt-3 text-sm">
              <p className="text-xs text-muted uppercase">Accessible viewing</p>
              <p className="whitespace-pre-line">{String(settings.accessible_viewing)}</p>
            </div>
          )}
        </Card>
      </div>

      {topResults.length > 0 && (
        <Card title="People's Choice results">
          <ol className="space-y-2">
            {topResults.map((r, i) => (
              <li key={r.unit_id} className="flex items-center gap-3">
                <span className="text-2xl">{["🥇", "🥈", "🥉"][i]}</span>
                <span className="flex-1 font-medium">{r.unit_name}</span>
                <span className="text-sm text-muted tabular-nums">{r.votes} votes</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card
        title="Photos"
        actions={
          <Link href={`/events/${slug}/photos`} className="text-sm text-brand hover:underline">
            {photos && photos.length > 0 ? "See all · share a photo" : "Share a photo"}
          </Link>
        }
      >
        {photos && photos.length > 0 ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((p) =>
              photoUrls.get(p.storage_path) ? (
                <li key={p.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URLs */}
                  <img src={photoUrls.get(p.storage_path)} alt={p.caption ?? "Parade photo"} className="aspect-square w-full rounded-md object-cover" loading="lazy" />
                </li>
              ) : null,
            )}
          </ul>
        ) : (
          <p className="text-sm text-muted">No photos yet. Share yours. They appear after a quick review.</p>
        )}
      </Card>

      {sponsors && sponsors.length > 0 && (
        <Card title="Thank you to our sponsors">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sponsors.map((s) => (
              <li key={s.id} className="rounded-md border border-border p-3">
                <p className="text-xs text-muted">{TIER_LABEL[s.tier]}</p>
                <p className="font-semibold">
                  {s.website ? (
                    <a href={s.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                </p>
                {s.description && <p className="mt-1 text-sm">{s.description}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
