import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventBySlug, registrationOpen } from "@/lib/data";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge, ButtonLink, Card, EmptyState, Notice } from "@/components/ui";

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
  checkpoints: { code: string; name: string; sequence: number }[];
}

interface Progress {
  unit_id: string;
  phase: "staging" | "on_route" | "finished" | "not_participating";
  last_checkpoint_name: string | null;
  last_reported_at: string | null;
}

const PHASE_LABEL: Record<Progress["phase"], string> = {
  staging: "Staging",
  on_route: "On route",
  finished: "Finished",
  not_participating: "Not participating",
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
  const [{ data: announcements }, { data: publication }, { data: progress }] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, body, is_emergency, published_at")
      .eq("event_id", event.id)
      .eq("audience", "public")
      .order("published_at", { ascending: false })
      .limit(10),
    supabase.rpc("latest_publication", { p_event_slug: slug }),
    supabase.rpc("public_progress", { p_event_slug: slug }),
  ]);

  const pub = publication as Publication | null;
  const progressByUnit = new Map(((progress as Progress[] | null) ?? []).map((p) => [p.unit_id, p]));
  const settings = event.settings as Record<string, string | boolean | undefined>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
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
                <ol className="divide-y divide-border">
                  {pub.lineup.map((u) => {
                    const p = progressByUnit.get(u.unit_id);
                    return (
                      <li key={u.unit_id} className="flex gap-3 py-3">
                        <span className="w-8 shrink-0 text-right font-mono text-sm text-muted">{u.sequence}</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{u.name}</p>
                          {u.category && <p className="text-xs text-muted">{u.category}</p>}
                          {u.description && <p className="mt-1 text-sm">{u.description}</p>}
                        </div>
                        {p && (
                          <div className="text-right">
                            <Badge tone={p.phase === "on_route" ? "info" : p.phase === "finished" ? "good" : "neutral"}>
                              {PHASE_LABEL[p.phase]}
                            </Badge>
                            {p.last_checkpoint_name && (
                              <p className="mt-1 text-xs text-muted">Near {p.last_checkpoint_name}</p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
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
          <p className="mt-4 text-xs text-muted">An interactive route map will be added here.</p>
        </Card>
      </div>
    </main>
  );
}
