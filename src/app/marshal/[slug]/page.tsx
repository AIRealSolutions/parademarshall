import Link from "next/link";
import { requireStaffEvent } from "@/lib/data";
import { ROLE_LABELS } from "@/lib/domain/roles";

export default async function MarshalModes({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { access } = await requireStaffEvent(slug);
  const has = (...r: string[]) => access.isSystemAdmin || access.roles.some((x) => r.includes(x));
  const modes = [
    has("parade_director", "assistant_director", "staging_marshal", "dispatch_controller") && {
      href: `/marshal/${slug}/checkin`,
      title: "Staging check-in",
      body: "Scan passes, check units in, mark them staged and ready.",
    },
    has("parade_director", "assistant_director", "checkpoint_marshal", "dispatch_controller") && {
      href: `/marshal/${slug}/checkpoint`,
      title: "Checkpoint",
      body: "Record units as they pass your checkpoint.",
    },
    has("parade_director", "dispatch_controller") && {
      href: `/admin/${slug}/dispatch`,
      title: "Dispatch",
      body: "Authorize and release units at the merge.",
    },
    has("traffic_officer", "police_chief", "fire_chief", "public_safety_liaison", "parade_director", "assistant_director", "dispatch_controller") && {
      href: `/marshal/${slug}/traffic`,
      title: "Traffic control",
      body: "Parade head and tail, which stretches are clear, road closures and the parade hold.",
    },
    has("fire_chief", "police_chief", "public_safety_liaison", "assistant_director") && {
      href: `/admin/${slug}/dispatch`,
      title: "Live operations",
      body: "Watch dispatch, the parade hold and every unit's status in real time.",
    },
    has("fire_chief", "police_chief", "traffic_officer", "public_safety_liaison", "parade_director", "assistant_director") && {
      href: `/admin/${slug}/safety`,
      title: "Safety & incidents",
      body: "Open incidents, street restrictions and safety notices.",
    },
  ].filter(Boolean) as { href: string; title: string; body: string }[];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{access.roles.map((r) => ROLE_LABELS[r]).join(", ") || "System Administrator"}</p>
      {modes.map((m) => (
        <Link key={m.title} href={m.href} className="block rounded-xl border border-border bg-surface p-5 active:bg-stone-100">
          <p className="text-xl font-semibold">{m.title}</p>
          <p className="mt-1 text-sm text-muted">{m.body}</p>
        </Link>
      ))}
      <p className="pt-4 text-xs text-muted">
        This app supports field work. It does not replace police, fire, emergency communications or incident command.
      </p>
    </div>
  );
}
