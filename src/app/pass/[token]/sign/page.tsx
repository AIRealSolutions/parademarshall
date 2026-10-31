import type { Metadata } from "next";
import Link from "next/link";
import { passUrl } from "@/lib/pass";
import { siteOrigin } from "@/lib/site-origin";
import { DashboardSign, SignPrintStyles } from "@/components/pass/dashboard-sign";
import { PrintButton } from "@/components/print-button";
import { stagingLabel } from "@/components/pass/pass-view";
import { loadPass } from "../load";

export const metadata: Metadata = { title: "Dashboard sign", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pass = await loadPass(token);
  return (
    <main className="space-y-4 px-4 py-6 print:p-0">
      <SignPrintStyles />
      <div className="mx-auto flex max-w-[10.2in] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/pass/${token}`} className="text-sm text-brand hover:underline">
          ← Back to pass
        </Link>
        <p className="text-sm text-muted">Print on US Letter, landscape. Place it in your windshield, facing out.</p>
        <PrintButton label="Print sign" />
      </div>
      <div className="overflow-x-auto print:overflow-visible">
        <div className="mx-auto w-fit shadow-lg print:shadow-none">
          <DashboardSign
            url={passUrl(token, await siteOrigin())}
            eventTitle={`${pass.event.year} ${pass.event.name}`}
            unitName={pass.unit.name}
            sequence={pass.unit.sequence_number}
            staging={stagingLabel(pass)}
          />
        </div>
      </div>
    </main>
  );
}
