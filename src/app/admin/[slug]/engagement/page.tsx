import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent, votingOpen } from "@/lib/data";
import { signedPhotoUrls } from "@/lib/photos";
import { toLocalInput } from "@/lib/format";
import { isChiefDirector, isDirector } from "@/lib/domain/roles";
import { PageHeader } from "@/components/ui";
import { EngagementConsole, type Photo, type Sponsor } from "./engagement-console";

export default async function EngagementPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const supabase = await createClient();
  const [{ data: sponsors }, { data: results }, { data: photos }] = await Promise.all([
    supabase.from("sponsors").select("id, name, tier, website, description, is_published, sort_order").eq("event_id", event.id).order("sort_order").order("name"),
    supabase.rpc("vote_results", { p_event_id: event.id }),
    supabase
      .from("photo_submissions")
      .select("id, storage_path, caption, credit_name, status, created_at, parade_units(name), profiles:submitted_by(full_name, email)")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const urls = await signedPhotoUrls((photos ?? []).map((p) => p.storage_path));

  return (
    <>
      <PageHeader title="Engagement" subtitle="Sponsors, People's Choice voting and spectator photos." />
      <EngagementConsole
        eventId={event.id}
        slug={slug}
        timezone={event.timezone}
        canEdit={isDirector(access)}
        canSetVoting={isChiefDirector(access)}
        voting={{
          opens_at: toLocalInput(event.voting_opens_at, event.timezone),
          closes_at: toLocalInput(event.voting_closes_at, event.timezone),
          results_published: event.voting_results_published,
          open: votingOpen(event),
        }}
        results={(results as { unit_id: string; unit_name: string; sequence_number: number | null; votes: number }[] | null) ?? []}
        sponsors={(sponsors ?? []) as Sponsor[]}
        photos={(photos ?? []).map((p) => ({ ...(p as unknown as Photo), url: urls.get(p.storage_path) ?? null }))}
      />
    </>
  );
}
