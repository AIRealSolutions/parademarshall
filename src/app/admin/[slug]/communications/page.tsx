import { createClient } from "@/lib/supabase/server";
import { requireStaffEvent } from "@/lib/data";
import { providerStatus } from "@/lib/notifications/deliver";
import { isDirector } from "@/lib/domain/roles";
import { PageHeader } from "@/components/ui";
import { CommunicationsConsole, type Announcement, type NotificationRow } from "./communications-console";

export default async function CommunicationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const supabase = await createClient();
  const [{ data: announcements }, { data: notifications }] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, audience, title, body, is_emergency, published_at, expires_at, created_at, profiles:issued_by(full_name, email)")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("notifications")
      .select("id, channel, subject, status, error, created_at, sent_at, profiles:recipient_id(full_name, email)")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const can = (...r: string[]) => access.isSystemAdmin || access.roles.some((x) => r.includes(x));

  return (
    <>
      <PageHeader title="Communications" subtitle="Public and participant announcements, staff alerts, and the email/SMS delivery log." />
      <CommunicationsConsole
        eventId={event.id}
        slug={slug}
        timezone={event.timezone}
        canAnnounce={can("parade_director", "assistant_director", "public_safety_liaison")}
        canEmergency={can("parade_director", "public_safety_liaison")}
        canDeliver={isDirector(access)}
        providers={providerStatus()}
        announcements={(announcements ?? []) as unknown as Announcement[]}
        notifications={(notifications ?? []) as unknown as NotificationRow[]}
      />
    </>
  );
}
