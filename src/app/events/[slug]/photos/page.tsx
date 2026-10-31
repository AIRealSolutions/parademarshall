import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventBySlug, getUser } from "@/lib/data";
import { signedPhotoUrls } from "@/lib/photos";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { PhotoUpload } from "./photo-upload";

export const metadata: Metadata = { title: "Photos" };

export default async function PhotosPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();
  const user = await getUser();
  const supabase = await createClient();

  const [{ data: approved }, { data: mine }, { data: publication }] = await Promise.all([
    supabase
      .from("photo_submissions")
      .select("id, storage_path, caption, credit_name, unit_id")
      .eq("event_id", event.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(60),
    user
      ? supabase
          .from("photo_submissions")
          .select("id, storage_path, caption, status")
          .eq("event_id", event.id)
          .eq("submitted_by", user.id)
          .neq("status", "approved")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; storage_path: string; caption: string | null; status: string }[] }),
    supabase.rpc("latest_publication", { p_event_slug: slug }),
  ]);
  const urls = await signedPhotoUrls([...(approved ?? []), ...(mine ?? [])].map((p) => p.storage_path));
  const lineup = ((publication as { lineup?: { unit_id: string; sequence: number; name: string }[] } | null)?.lineup ?? []);
  const unitName = new Map(lineup.map((u) => [u.unit_id, u.name]));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <p className="text-sm">
        <Link href={`/events/${slug}`} className="text-brand hover:underline">
          ← {event.year} {event.name}
        </Link>
      </p>
      <PageHeader title="Parade photos" subtitle="Shared by spectators and participants. Every photo is reviewed before it appears here." />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section>
          {approved && approved.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {approved.map((p) =>
                urls.get(p.storage_path) ? (
                  <li key={p.id} className="overflow-hidden rounded-md border border-border bg-surface">
                    {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URLs */}
                    <img src={urls.get(p.storage_path)} alt={p.caption ?? "Parade photo"} className="aspect-square w-full object-cover" loading="lazy" />
                    {(p.caption || p.credit_name || p.unit_id) && (
                      <div className="p-2 text-xs">
                        {p.caption && <p>{p.caption}</p>}
                        {p.unit_id && unitName.get(p.unit_id) && <p className="text-muted">{unitName.get(p.unit_id)}</p>}
                        {p.credit_name && <p className="text-muted">📷 {p.credit_name}</p>}
                      </div>
                    )}
                  </li>
                ) : null,
              )}
            </ul>
          ) : (
            <EmptyState>No photos yet. Be the first to share one.</EmptyState>
          )}
        </section>

        <aside className="space-y-4">
          <Card title="Share a photo">
            {user ? (
              <PhotoUpload eventId={event.id} userId={user.id} units={lineup} />
            ) : (
              <p className="text-sm">
                <Link href={`/login?next=/events/${slug}/photos`} className="text-brand underline">
                  Sign in
                </Link>{" "}
                to share photos. Viewing doesn&apos;t need an account.
              </p>
            )}
          </Card>
          {mine && mine.length > 0 && (
            <Card title="Your submissions">
              <ul className="space-y-2">
                {mine.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    {urls.get(p.storage_path) && (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URLs
                      <img src={urls.get(p.storage_path)} alt="" className="h-12 w-12 rounded object-cover" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{p.caption ?? "Photo"}</span>
                    <Badge tone={p.status === "rejected" ? "bad" : "warn"}>{p.status === "pending" ? "in review" : "not approved"}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </main>
  );
}
