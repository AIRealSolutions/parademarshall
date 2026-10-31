import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { PASS_STEPS, passStatus, type UnitPass } from "@/lib/domain/pass";
import { ParadeMap } from "@/components/map";
import { AutoRefresh } from "@/components/auto-refresh";
import { PrintButton } from "@/components/print-button";
import { SavePassImage } from "@/components/pass/save-pass-image";
import { buttonClass } from "@/components/ui";

const TONE = {
  info: "border-sky-200 bg-sky-50 text-sky-950",
  good: "border-emerald-200 bg-emerald-50 text-emerald-950",
  warn: "border-amber-300 bg-amber-50 text-amber-950",
  bad: "border-rose-300 bg-rose-50 text-rose-950",
};

export function stagingLabel(p: UnitPass) {
  return p.staging ? `${p.staging.street} · Lane ${p.staging.lane} · Block ${p.staging.block}` : null;
}

export function PassView({ pass, token, url, svg }: { pass: UnitPass; token: string; url: string; svg: string }) {
  const status = passStatus(pass);
  const stepIndex = PASS_STEPS.findIndex((s) => s.key === status.step);
  const staging = stagingLabel(pass);
  const eventTitle = `${pass.event.year} ${pass.event.name}`;
  const e = pass.event;

  const steps = [
    pass.staging
      ? `Arrive at ${pass.staging.street}, lane ${pass.staging.lane}, block ${pass.staging.block}.${e.arrival_instructions ? "" : " Arrive early so marshals can stage you."}`
      : "Arrive at the staging area listed in your instructions email.",
    "Show this pass to a staging marshal, on your phone or printed. They'll scan the QR code to check you in.",
    "Put your dashboard sign in your windshield so marshals can read your lineup number.",
    "Stay with your unit. When marshals say you're ready, line up and wait for their signal.",
    `${e.merge_point ? `At ${e.merge_point}, the` : "The"} dispatch marshal releases one unit at a time. Move up only when waved.`,
    `${e.direction ? `${e.direction}` : "Follow the route"}${e.finish ? ` to ${e.finish}` : ""}. Keep a steady pace, keep your spacing, and don't throw items from moving vehicles.`,
    "After the finish, follow marshals' directions out of the area.",
  ];

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-6 print:max-w-none print:py-0">
      {e.status === "live" && <AutoRefresh seconds={30} />}

      {e.parade_hold && (
        <div className="rounded-xl bg-accent p-4 text-white print:hidden" role="alert">
          <p className="text-lg font-bold">Parade on hold</p>
          <p className="text-sm">{e.parade_hold_reason ?? "Please stay where you are and follow marshal instructions."}</p>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm print:shadow-none" aria-label="Parade pass">
        <div className="chevron-stripe h-2" aria-hidden />
        <div className="space-y-1 px-5 pt-4 text-center">
          <p className="text-sm font-medium text-muted">{eventTitle}</p>
          <p className="text-xs font-bold tracking-[0.2em] text-accent uppercase">Parade unit</p>
          <p className="text-7xl leading-none font-black tabular-nums">{pass.unit.sequence_number ?? "TBD"}</p>
          <p className="text-xl font-semibold">{pass.unit.name}</p>
          {pass.unit.category && <p className="text-sm text-muted">{pass.unit.category}</p>}
        </div>
        <div className="mx-auto my-4 w-64 max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="space-y-1 border-t border-border px-5 py-3 text-center text-sm">
          {staging ? (
            <>
              <p className="font-semibold">Staging: {staging}</p>
              <p className="text-muted">Reserved space: about {Math.round(pass.unit.length_ft)} ft</p>
            </>
          ) : (
            <p className="text-muted">Staging location to be assigned</p>
          )}
          {e.starts_at && <p className="text-muted">Parade starts {formatDateTime(e.starts_at, e.timezone)}</p>}
        </div>
        <div className="chevron-stripe h-2" aria-hidden />
      </section>

      <section className={`rounded-xl border p-4 print:hidden ${TONE[status.tone]}`} aria-live="polite">
        <p className="text-lg font-semibold">{status.headline}</p>
        {status.detail && <p className="mt-1 text-sm">{status.detail}</p>}
        <ol className="mt-4 flex items-center gap-1" aria-label="Progress">
          {PASS_STEPS.map((s, i) => (
            <li key={s.key} className="flex flex-1 flex-col items-center gap-1 text-center">
              <span
                className={`h-2 w-full rounded-full ${i <= stepIndex ? "bg-current opacity-80" : "bg-black/10"}`}
                aria-hidden
              />
              <span className={`text-[11px] leading-tight ${i === stepIndex ? "font-bold" : "opacity-70"}`}>
                {s.label}
                {i === stepIndex && <span className="sr-only"> (current)</span>}
              </span>
            </li>
          ))}
        </ol>
        {e.status === "live" && <p className="mt-3 text-xs opacity-70">Updates automatically every 30 seconds.</p>}
      </section>

      <div className="flex flex-wrap gap-2 print:hidden">
        <PrintButton label="Print pass" />
        <Link href={`/pass/${token}/sign`} className={buttonClass("secondary")}>
          Dashboard sign
        </Link>
        <SavePassImage url={url} eventTitle={eventTitle} unitName={pass.unit.name} sequence={pass.unit.sequence_number} staging={staging} />
      </div>

      <section className="rounded-xl border border-border bg-surface p-4 print:border-0 print:p-0">
        <h2 className="mb-2 font-semibold">What to expect</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {e.arrival_instructions && (
          <div className="mt-3 rounded-md bg-stone-50 p-3 text-sm whitespace-pre-line">{e.arrival_instructions}</div>
        )}
      </section>

      {(pass.route.length > 0 || pass.staging?.geometry) && (
        <section className="print:hidden" aria-label="Map">
          <ParadeMap
            route={pass.route}
            checkpoints={pass.checkpoints}
            highlight={pass.staging?.geometry ? { geometry: pass.staging.geometry, label: "Your staging spot" } : null}
            fit="all"
            className="h-72"
          />
          <p className="mt-1 text-xs text-muted">Purple: your staging spot. Blue: the parade route.</p>
        </section>
      )}

      <p className="text-center text-xs text-muted">
        Share this pass only with your unit. Anyone holding it can check in as your unit.
      </p>
    </main>
  );
}
