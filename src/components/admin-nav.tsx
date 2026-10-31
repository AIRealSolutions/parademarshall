"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SECTION_GROUPS, visibleSections, type AdminSection } from "@/lib/admin-nav";

const hrefFor = (slug: string, s: AdminSection) => `/admin/${slug}${s.slug ? `/${s.slug}` : ""}`;

function useActive(slug: string) {
  const pathname = usePathname();
  return (s: AdminSection) => {
    const href = hrefFor(slug, s);
    return s.slug ? pathname.startsWith(href) : pathname === href;
  };
}

/** Desktop sidebar: all sections, grouped. */
export function AdminNav({ slug, roles, isAdmin }: { slug: string; roles: string[]; isAdmin: boolean }) {
  const { sections } = visibleSections(roles, isAdmin);
  const isActive = useActive(slug);
  return (
    <nav aria-label="Staff sections" className="space-y-4">
      {SECTION_GROUPS.map((group) => {
        const items = sections.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group}>
            {group !== "Overview" && (
              <p className="mb-1 px-3 text-[11px] font-semibold tracking-wide text-muted uppercase">{group}</p>
            )}
            <ul className="space-y-0.5">
              {items.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={hrefFor(slug, s)}
                    aria-current={isActive(s) ? "page" : undefined}
                    className={`block rounded-md px-3 py-2 text-sm ${
                      isActive(s) ? "bg-brand text-white" : "text-foreground hover:bg-stone-100"
                    }`}
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  "": <path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  applications: <path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" />,
  staging: <path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13" />,
  dispatch: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  safety: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM12 8v5M12 16h.01" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
};

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name] ?? ICONS.applications}
    </svg>
  );
}

/** Phone navigation: a fixed bottom tab bar plus a full-screen grouped menu. */
export function AdminTabBar({ slug, roles, isAdmin }: { slug: string; roles: string[]; isAdmin: boolean }) {
  const { sections, tabs } = visibleSections(roles, isAdmin);
  const isActive = useActive(slug);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the menu after navigating, and on Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const menuActive = !tabs.some(isActive);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[1100] flex flex-col bg-background lg:hidden" role="dialog" aria-modal="true" aria-label="All staff sections">
          <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
            <p className="font-semibold">All sections</p>
            <button className="rounded-md px-3 py-1.5 text-sm font-medium text-brand" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 pb-28">
            {SECTION_GROUPS.map((group) => {
              const items = sections.filter((s) => s.group === group);
              if (items.length === 0) return null;
              return (
                <section key={group}>
                  <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{group}</h2>
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                    {items.map((s) => (
                      <li key={s.slug}>
                        <Link
                          href={hrefFor(slug, s)}
                          aria-current={isActive(s) ? "page" : undefined}
                          className={`flex items-center gap-3 px-4 py-3 active:bg-stone-100 ${isActive(s) ? "bg-brand/5" : ""}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className={`block font-medium ${isActive(s) ? "text-brand" : ""}`}>{s.label}</span>
                            <span className="block text-xs text-muted">{s.summary}</span>
                          </span>
                          <span className="text-muted" aria-hidden>
                            ›
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}

      <nav
        aria-label="Staff sections"
        className="fixed inset-x-0 bottom-0 z-[1200] border-t border-border bg-surface/95 backdrop-blur lg:hidden print:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto flex max-w-xl">
          {tabs.map((s) => (
            <li key={s.slug} className="flex-1">
              <Link
                href={hrefFor(slug, s)}
                aria-current={isActive(s) ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  isActive(s) && !open ? "text-brand" : "text-muted"
                }`}
              >
                <Icon name={s.slug} />
                {s.short}
              </Link>
            </li>
          ))}
          <li className="flex-1">
            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                open || menuActive ? "text-brand" : "text-muted"
              }`}
            >
              <Icon name="menu" />
              Menu
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
