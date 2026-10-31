"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Card, EmptyState, Notice, buttonClass } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { formatDateTime } from "@/lib/format";
import { createAnnouncement, setAnnouncementPublished } from "@/lib/actions/staff";
import { deliverNow } from "@/lib/actions/notifications";

export interface Announcement {
  id: string;
  audience: "public" | "participants" | "staff";
  title: string;
  body: string;
  is_emergency: boolean;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
  profiles: { full_name: string | null; email: string | null } | null;
}
export interface NotificationRow {
  id: string;
  channel: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
}

function liveState(a: Announcement) {
  const now = Date.now();
  if (!a.published_at) return "draft";
  if (a.expires_at && new Date(a.expires_at).getTime() <= now) return "withdrawn";
  return new Date(a.published_at).getTime() <= now ? "live" : "scheduled";
}

export function CommunicationsConsole({
  eventId,
  slug,
  timezone,
  canAnnounce,
  canEmergency,
  canDeliver,
  providers,
  announcements,
  notifications,
}: {
  eventId: string;
  slug: string;
  timezone: string;
  canAnnounce: boolean;
  canEmergency: boolean;
  canDeliver: boolean;
  providers: { email: boolean; sms: boolean; worker: boolean };
  announcements: Announcement[];
  notifications: NotificationRow[];
}) {
  const action = useAction();
  const blank = { audience: "public", title: "", body: "", is_emergency: false, expires_at: "" };
  const [form, setForm] = useState(blank);
  const pending = notifications.filter((n) => n.status === "pending" && n.channel !== "in_app").length;

  async function submit(publish: boolean) {
    const ok = await action.run(
      () =>
        createAnnouncement({
          event_id: eventId,
          audience: form.audience,
          title: form.title,
          body: form.body,
          is_emergency: form.is_emergency,
          publish,
          expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        }),
      publish ? "Announcement published." : "Draft saved.",
    );
    if (ok) setForm(blank);
  }

  return (
    <div className="space-y-6">
      {action.error && <Notice tone="bad">{action.error}</Notice>}
      {action.message && <Notice tone="good">{action.message}</Notice>}

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card title="Announcements">
          {announcements.length === 0 ? (
            <EmptyState>No announcements yet.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {announcements.map((a) => {
                const state = liveState(a);
                return (
                  <li key={a.id} className={`rounded-md border p-3 text-sm ${a.is_emergency ? "border-rose-300 bg-rose-50" : "border-border"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={state === "live" ? "good" : state === "draft" ? "neutral" : "warn"}>{state}</Badge>
                      <Badge tone="info">{a.audience}</Badge>
                      {a.is_emergency && <Badge tone="bad">emergency</Badge>}
                      <span className="font-medium">{a.title}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-line">{a.body}</p>
                    <p className="mt-1 text-xs text-muted">
                      {a.profiles?.full_name || a.profiles?.email} · {formatDateTime(a.published_at ?? a.created_at, timezone)}
                      {a.expires_at && state === "live" && ` · until ${formatDateTime(a.expires_at, timezone)}`}
                    </p>
                    {canAnnounce && (!a.is_emergency || canEmergency) && (
                      <div className="mt-2 flex gap-2">
                        {state !== "live" && (
                          <button className={buttonClass("secondary")} disabled={action.pending} onClick={() => action.run(() => setAnnouncementPublished(a.id, true), "Published.")}>
                            Publish now
                          </button>
                        )}
                        {state === "live" && (
                          <button className={buttonClass("secondary")} disabled={action.pending} onClick={() => action.run(() => setAnnouncementPublished(a.id, false), "Withdrawn.")}>
                            Withdraw
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {canAnnounce && (
          <Card title="New announcement">
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit(true);
              }}
            >
              <select className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} aria-label="Audience">
                <option value="public">Public (spectator page)</option>
                <option value="participants">Participants</option>
                <option value="staff">Staff only</option>
              </select>
              <input className="input" required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <textarea className="input" required rows={4} placeholder="Message" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              <label className="block text-xs">
                Expires (optional)
                <input className="input mt-1" type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
              </label>
              {canEmergency && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.is_emergency} onChange={(e) => setForm({ ...form, is_emergency: e.target.checked })} />
                  Emergency instruction (shown prominently)
                </label>
              )}
              <div className="flex gap-2">
                <button className={buttonClass(form.is_emergency ? "danger" : "primary")} disabled={action.pending}>
                  Publish
                </button>
                <button type="button" className={buttonClass("secondary")} disabled={action.pending || !form.title || !form.body} onClick={() => submit(false)}>
                  Save draft
                </button>
              </div>
              <p className="text-xs text-muted">
                Public announcements appear on <Link href={`/events/${slug}`} className="underline">the spectator page</Link>.
              </p>
            </form>
          </Card>
        )}
      </div>

      <Card
        title="Delivery log"
        actions={
          canDeliver && (
            <button
              className={buttonClass("secondary")}
              disabled={action.pending || pending === 0 || !providers.worker}
              onClick={() => action.run(() => deliverNow(eventId), (r) => `Sent ${r?.sent ?? 0}, failed ${r?.failed ?? 0}, waiting ${r?.skipped ?? 0}.`)}
            >
              Deliver {pending} pending now
            </button>
          )
        }
      >
        {(!providers.email || !providers.worker) && (
          <div className="mb-3">
            <Notice tone="warn">
              {!providers.worker && "Delivery worker not configured (SUPABASE_SERVICE_ROLE_KEY). "}
              {!providers.email && "Email provider not configured (RESEND_API_KEY, NOTIFICATION_FROM_EMAIL). "}
              {!providers.sms && "SMS not configured; SMS alerts fall back to email. "}
              Messages stay queued until delivery is configured.
            </Notice>
          </div>
        )}
        {notifications.length === 0 ? (
          <EmptyState>No notifications yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted uppercase">
                <tr>
                  <th className="py-1 font-medium">Queued</th>
                  <th className="py-1 font-medium">To</th>
                  <th className="py-1 font-medium">Channel</th>
                  <th className="py-1 font-medium">Subject</th>
                  <th className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {notifications.map((n) => (
                  <tr key={n.id}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{formatDateTime(n.created_at, timezone)}</td>
                    <td className="py-1.5 pr-2">{n.profiles?.full_name || n.profiles?.email}</td>
                    <td className="py-1.5 pr-2">{n.channel.replace("_", "-")}</td>
                    <td className="py-1.5 pr-2">{n.subject}</td>
                    <td className="py-1.5" title={n.error ?? undefined}>
                      <Badge tone={n.status === "sent" ? "good" : n.status === "failed" ? "bad" : "neutral"}>{n.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
