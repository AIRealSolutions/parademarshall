"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_SECTIONS } from "@/lib/admin-nav";

export function AdminNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Staff sections" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {ADMIN_SECTIONS.map((s) => {
          const href = `/admin/${slug}${s.slug ? `/${s.slug}` : ""}`;
          const active = s.slug ? pathname.startsWith(href) : pathname === href;
          return (
            <li key={s.slug} className="shrink-0">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm ${
                  active ? "bg-brand text-white" : "text-foreground hover:bg-stone-100"
                }`}
              >
                {s.label}
                {s.phase && (
                  <span className={`text-[10px] ${active ? "text-white/80" : "text-muted"}`}>P{s.phase}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
