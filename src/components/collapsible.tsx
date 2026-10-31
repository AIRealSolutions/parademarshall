"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A section that starts folded on phones and open on larger screens, so the
 * most important content comes first on small screens.
 */
export function Collapsible({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) setOpen(true);
  }, []);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="group rounded-lg border border-border bg-surface"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex-1 font-semibold">{title}</span>
        {meta && <span className="text-sm text-muted">{meta}</span>}
        <span className="text-muted transition group-open:rotate-90" aria-hidden>
          ›
        </span>
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}
