"use client";

import { useState } from "react";
import { Badge, Card, EmptyState, Notice, buttonClass } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { formatDateTime, fromLocalInput } from "@/lib/format";
import { deleteSponsor, moderatePhoto, saveSponsor, setVoting } from "@/lib/actions/engagement";

export interface Sponsor {
  id: string;
  name: string;
  tier: "presenting" | "gold" | "silver" | "community";
  website: string | null;
  description: string | null;
  is_published: boolean;
}
export interface Photo {
  id: string;
  storage_path: string;
  caption: string | null;
  credit_name: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  parade_units: { name: string } | null;
  profiles: { full_name: string | null; email: string | null } | null;
  url: string | null;
}

const blankSponsor = { name: "", tier: "community" as Sponsor["tier"], website: "", description: "", is_published: true };

export function EngagementConsole({
  eventId,
  slug,
  timezone,
  canEdit,
  canSetVoting,
  voting,
  results,
  sponsors,
  photos,
}: {
  eventId: string;
  slug: string;
  timezone: string;
  canEdit: boolean;
  canSetVoting: boolean;
  voting: { opens_at: string; closes_at: string; results_published: boolean; open: boolean };
  results: { unit_id: string; unit_name: string; sequence_number: number | null; votes: number }[];
  sponsors: Sponsor[];
  photos: Photo[];
}) {
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(blankSponsor);
  const [vote, setVote] = useState(voting);
  const [photoFilter, setPhotoFilter] = useState<Photo["status"]>("pending");
  const total = results.reduce((s, r) => s + Number(r.votes), 0);
  const shownPhotos = photos.filter((p) => p.status === photoFilter);

  function editSponsor(s: Sponsor | null) {
    setEditing(s?.id ?? "new");
    setForm(s ? { name: s.name, tier: s.tier, website: s.website ?? "", description: s.description ?? "", is_published: s.is_published } : blankSponsor);
  }

  return (
    <div className="space-y-6">
      {action.error && <Notice tone="bad">{action.error}</Notice>}
      {action.message && <Notice tone="good">{action.message}</Notice>}

      <Card title={`Photo moderation (${photos.filter((p) => p.status === "pending").length} waiting)`}>
        <div className="mb-3 flex gap-2 text-sm">
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <button key={s} onClick={() => setPhotoFilter(s)} className={`rounded-full px-3 py-1 ${photoFilter === s ? "bg-brand text-white" : "bg-stone-100"}`}>
              {s}
            </button>
          ))}
        </div>
        {shownPhotos.length === 0 ? (
          <EmptyState>No {photoFilter} photos.</EmptyState>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {shownPhotos.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-md border border-border">
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URLs
                  <img src={p.url} alt={p.caption ?? "Submitted photo"} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-stone-100 text-xs text-muted">File missing</div>
                )}
                <div className="space-y-1 p-2 text-xs">
                  {p.caption && <p>{p.caption}</p>}
                  <p className="text-muted">
                    {p.profiles?.full_name || p.profiles?.email} · {formatDateTime(p.created_at, timezone)}
                  </p>
                  {p.parade_units && <p className="text-muted">Unit: {p.parade_units.name}</p>}
                  {canEdit && (
                    <div className="flex gap-1 pt-1">
                      {p.status !== "approved" && (
                        <button className={buttonClass()} disabled={action.pending} onClick={() => action.run(() => moderatePhoto(p.id, "approved"), "Photo approved.")}>
                          Approve
                        </button>
                      )}
                      {p.status !== "rejected" && (
                        <button className={buttonClass("secondary")} disabled={action.pending} onClick={() => action.run(() => moderatePhoto(p.id, "rejected"), "Photo rejected.")}>
                          Reject
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="People's Choice voting">
          <p className="mb-3 text-sm">
            {vote.open ? <Badge tone="good">Voting open</Badge> : <Badge>Voting closed</Badge>} {total} vote(s). One vote per signed-in person;
            voters can change their pick while voting is open. Only units in the published lineup can be chosen.
          </p>
          {canSetVoting && (
            <form
              className="mb-4 grid gap-2 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                action.run(
                  () =>
                    setVoting(eventId, {
                      opens_at: fromLocalInput(vote.opens_at, timezone),
                      closes_at: fromLocalInput(vote.closes_at, timezone),
                      results_published: vote.results_published,
                    }),
                  "Voting settings saved.",
                );
              }}
            >
              <label className="text-xs">
                Opens
                <input className="input mt-1 text-sm" type="datetime-local" value={vote.opens_at} onChange={(e) => setVote({ ...vote, opens_at: e.target.value })} />
              </label>
              <label className="text-xs">
                Closes
                <input className="input mt-1 text-sm" type="datetime-local" value={vote.closes_at} onChange={(e) => setVote({ ...vote, closes_at: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={vote.results_published} onChange={(e) => setVote({ ...vote, results_published: e.target.checked })} />
                Show the top three on the public page
              </label>
              <button className={buttonClass()} disabled={action.pending}>
                Save voting settings
              </button>
            </form>
          )}
          {results.length === 0 ? (
            <EmptyState>No votes yet.</EmptyState>
          ) : (
            <ol className="space-y-2 text-sm">
              {results.map((r) => (
                <li key={r.unit_id}>
                  <div className="flex justify-between">
                    <span>
                      {r.sequence_number ? `#${r.sequence_number} ` : ""}
                      {r.unit_name}
                    </span>
                    <span className="tabular-nums">{r.votes}</span>
                  </div>
                  <div className="mt-1 h-2 rounded bg-stone-100">
                    <div className="h-2 rounded bg-brand" style={{ width: `${(Number(r.votes) / Math.max(1, Number(results[0].votes))) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card
          title="Sponsors"
          actions={
            canEdit && (
              <button className="text-sm text-brand hover:underline" onClick={() => editSponsor(null)}>
                + Add sponsor
              </button>
            )
          }
        >
          {editing && (
            <form
              className="mb-4 space-y-2 rounded-md bg-stone-50 p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await action.run(() => saveSponsor(eventId, editing === "new" ? null : editing, form), "Sponsor saved.")) setEditing(null);
              }}
            >
              <input className="input text-sm" required placeholder="Sponsor name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className="grid gap-2 sm:grid-cols-2">
                <select className="input text-sm" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as Sponsor["tier"] })} aria-label="Tier">
                  <option value="presenting">Presenting</option>
                  <option value="gold">Gold</option>
                  <option value="silver">Silver</option>
                  <option value="community">Community</option>
                </select>
                <input className="input text-sm" placeholder="https://website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </div>
              <textarea className="input text-sm" rows={2} placeholder="Short description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_published} onChange={(e) => setForm({ ...form, is_published: e.target.checked })} />
                Show on the public page
              </label>
              <div className="flex gap-2">
                <button className={buttonClass()} disabled={action.pending}>
                  Save
                </button>
                <button type="button" className={buttonClass("secondary")} onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          {sponsors.length === 0 ? (
            <EmptyState>No sponsors yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {sponsors.map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{s.name}</span> <span className="text-xs text-muted">{s.tier}</span>
                    {!s.is_published && <Badge>hidden</Badge>}
                  </span>
                  {canEdit && (
                    <>
                      <button className="text-xs text-brand hover:underline" onClick={() => editSponsor(s)}>
                        Edit
                      </button>
                      <button
                        className="text-xs text-muted hover:text-accent"
                        onClick={() => window.confirm(`Delete ${s.name}?`) && action.run(() => deleteSponsor(s.id), "Sponsor deleted.")}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">
            Published sponsors appear at the bottom of <a href={`/events/${slug}`} className="underline">the public page</a>.
          </p>
        </Card>
      </div>
    </div>
  );
}
