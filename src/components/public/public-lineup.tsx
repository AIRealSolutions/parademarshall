"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui";
import { castVote } from "@/lib/actions/engagement";

export interface PublicUnit {
  unit_id: string;
  sequence: number;
  name: string;
  category: string | null;
  description: string | null;
  phase?: "staging" | "on_route" | "finished" | "not_participating";
  near?: string | null;
}

const PHASE_LABEL = { staging: "Staging", on_route: "On route", finished: "Finished", not_participating: "Not participating" };

export function PublicLineup({
  slug,
  eventId,
  units,
  votingOpen,
  signedIn,
  myVote,
}: {
  slug: string;
  eventId: string;
  units: PublicUnit[];
  votingOpen: boolean;
  signedIn: boolean;
  myVote: string | null;
}) {
  const key = `favorites:${slug}`;
  const [favorites, setFavorites] = useState<string[]>([]);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [vote, setVote] = useState(myVote);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Favorites live only on this device; they are never sent to the server.
  useEffect(() => {
    try {
      setFavorites(JSON.parse(localStorage.getItem(key) ?? "[]"));
    } catch {}
  }, [key]);
  const toggle = (id: string) =>
    setFavorites((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });

  const shown = onlyFavorites ? units.filter((u) => favorites.includes(u.unit_id)) : units;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyFavorites} onChange={(e) => setOnlyFavorites(e.target.checked)} />
          Show my favorites ({favorites.length})
        </label>
        {votingOpen && (
          <span className="ml-auto text-xs text-muted">
            People&apos;s Choice voting is open
            {!signedIn && (
              <>
                {" · "}
                <Link href={`/login?next=/events/${slug}`} className="text-brand underline">
                  sign in to vote
                </Link>
              </>
            )}
          </span>
        )}
      </div>
      {voteError && <p className="mb-2 text-sm text-accent">{voteError}</p>}
      <ol className="divide-y divide-border">
        {shown.map((u) => {
          const fav = favorites.includes(u.unit_id);
          return (
            <li key={u.unit_id} className="flex gap-3 py-3">
              <span className="w-8 shrink-0 text-right font-mono text-sm text-muted">{u.sequence}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{u.name}</p>
                {u.category && <p className="text-xs text-muted">{u.category}</p>}
                {u.description && <p className="mt-1 text-sm">{u.description}</p>}
                {votingOpen && signedIn && (
                  <button
                    className={`mt-2 rounded-full px-3 py-1 text-xs font-medium ${vote === u.unit_id ? "bg-brand text-white" : "border border-border hover:border-brand"}`}
                    disabled={pending || vote === u.unit_id}
                    onClick={() =>
                      start(async () => {
                        setVoteError(null);
                        const r = await castVote(eventId, u.unit_id);
                        if (r.error) setVoteError(r.error);
                        else setVote(u.unit_id);
                      })
                    }
                  >
                    {vote === u.unit_id ? "★ Your People's Choice vote" : "Vote People's Choice"}
                  </button>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  onClick={() => toggle(u.unit_id)}
                  aria-pressed={fav}
                  aria-label={fav ? `Remove ${u.name} from favorites` : `Add ${u.name} to favorites`}
                  className={`text-xl leading-none ${fav ? "text-amber-500" : "text-stone-300 hover:text-amber-400"}`}
                >
                  ★
                </button>
                {u.phase && (
                  <Badge tone={u.phase === "on_route" ? "info" : u.phase === "finished" ? "good" : "neutral"}>
                    {PHASE_LABEL[u.phase]}
                  </Badge>
                )}
                {u.near && <span className="text-xs text-muted">Near {u.near}</span>}
              </div>
            </li>
          );
        })}
        {shown.length === 0 && <li className="py-6 text-center text-sm text-muted">No favorites yet. Tap ★ on any unit.</li>}
      </ol>
    </div>
  );
}
