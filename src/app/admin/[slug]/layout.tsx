import { requireStaffEvent } from "@/lib/data";
import { ROLE_LABELS } from "@/lib/domain/roles";
import { AdminNav } from "@/components/admin-nav";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const roleText = access.isSystemAdmin
    ? ["System Administrator", ...access.roles.map((r) => ROLE_LABELS[r])].join(", ")
    : access.roles.map((r) => ROLE_LABELS[r]).join(", ");

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3 print:hidden">
        <p className="font-semibold">
          {event.year} {event.name}
        </p>
        <p className="text-xs text-muted">{roleText}</p>
      </div>
      {event.parade_hold && (
        <div className="mb-4 rounded-md bg-accent px-4 py-3 text-sm font-semibold text-white print:hidden" role="status">
          PARADE-WIDE HOLD IN EFFECT{event.parade_hold_reason ? ` — ${event.parade_hold_reason}` : ""}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[14rem_1fr] print:block">
        <aside className="print:hidden">
          <AdminNav slug={slug} roles={access.roles} isAdmin={access.isSystemAdmin} />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
