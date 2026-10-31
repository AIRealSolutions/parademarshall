"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice, buttonClass } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { addCategory, cloneEvent, setCategoryActive } from "@/lib/actions/staff";

export function CategoryEditor({
  eventId,
  categories,
  canEdit,
}: {
  eventId: string;
  categories: { id: string; name: string; is_active: boolean }[];
  canEdit: boolean;
}) {
  const action = useAction();
  const [name, setName] = useState("");
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2 text-sm">
        {categories.map((c) => (
          <li key={c.id}>
            <button
              disabled={!canEdit || action.pending}
              onClick={() => action.run(() => setCategoryActive(c.id, !c.is_active))}
              title={canEdit ? (c.is_active ? "Click to hide from registration" : "Click to offer again") : undefined}
              className={`rounded-full px-3 py-1 ${c.is_active ? "bg-stone-100 hover:bg-stone-200" : "bg-stone-50 text-muted line-through"}`}
            >
              {c.name}
            </button>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await action.run(() => addCategory(eventId, name), "Category added.")) setName("");
          }}
        >
          <input className="input max-w-xs text-sm" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
          <button className={buttonClass("secondary")} disabled={action.pending || !name.trim()}>
            Add
          </button>
        </form>
      )}
      {action.error && <Notice tone="bad">{action.error}</Notice>}
    </div>
  );
}

export function CloneEventForm({ eventId, name, year }: { eventId: string; name: string; year: number }) {
  const router = useRouter();
  const action = useAction();
  const [v, setV] = useState({ name, year: year + 1, slug: "" });
  const slug = v.slug || `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${v.year}`;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await action.run(() => cloneEvent(eventId, slug, v.name, v.year), (newSlug) => {
          if (newSlug) router.push(`/admin/${newSlug}/settings`);
          return "Event created.";
        });
      }}
    >
      <p className="text-sm text-muted">
        Copies categories, waiver, route, checkpoints and staging geometry. Applications, units, placements, approvals and
        restrictions are not carried forward. The copy starts as a hidden draft and geometry must be field-validated again.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="input text-sm" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label="Event name" />
        <input className="input text-sm" type="number" value={v.year} onChange={(e) => setV({ ...v, year: Number(e.target.value) })} aria-label="Year" />
        <input className="input text-sm" placeholder={slug} value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} aria-label="URL slug" />
      </div>
      <button className={buttonClass("secondary")} disabled={action.pending}>
        Create {v.year} event from this one
      </button>
      {action.error && <Notice tone="bad">{action.error}</Notice>}
    </form>
  );
}
