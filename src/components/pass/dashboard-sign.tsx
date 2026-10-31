import QRCode from "qrcode";

// One landscape US Letter page for the windshield: a lineup number that reads
// from the street, plus the QR pass for check-in. Sized in inches for print.
export async function DashboardSign({
  url,
  eventTitle,
  unitName,
  sequence,
  staging,
}: {
  url: string;
  eventTitle: string;
  unitName: string;
  sequence: number | null;
  staging: string | null;
}) {
  const svg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const digits = sequence === null ? 0 : String(sequence).length;
  const numberSize = digits >= 3 ? "3.6in" : "4.8in";

  return (
    <section
      className="dashboard-sign mx-auto flex flex-col overflow-hidden bg-white text-black"
      style={{ width: "10.2in", height: "7.7in" }}
    >
      <div className="chevron-stripe" style={{ height: "0.35in" }} aria-hidden />
      <div className="flex flex-1 items-center gap-[0.4in] px-[0.45in]">
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="font-bold tracking-[0.2em] uppercase" style={{ fontSize: "0.32in" }}>
            Parade unit
          </p>
          <p className="leading-none font-black tabular-nums" style={{ fontSize: sequence === null ? "1.4in" : numberSize }}>
            {sequence ?? "TBD"}
          </p>
          <p className="mt-[0.1in] font-semibold leading-tight" style={{ fontSize: "0.42in" }}>
            {unitName}
          </p>
        </div>
        <div className="flex flex-col items-center" style={{ width: "2.9in" }}>
          <div style={{ width: "2.7in", height: "2.7in" }} dangerouslySetInnerHTML={{ __html: svg }} />
          <p className="mt-[0.08in] text-center font-semibold" style={{ fontSize: "0.2in" }}>
            Scan at check-in
          </p>
        </div>
      </div>
      <div className="flex items-end justify-between px-[0.45in] pb-[0.15in]" style={{ fontSize: "0.2in" }}>
        <span className="font-semibold">{eventTitle}</span>
        {staging && <span>Staging: {staging}</span>}
      </div>
      <div className="chevron-stripe" style={{ height: "0.35in" }} aria-hidden />
    </section>
  );
}

/** Print setup for sign pages: landscape letter, no browser margins. */
export function SignPrintStyles() {
  return (
    <style>{`
      @page { size: letter landscape; margin: 0.4in; }
      @media print {
        body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .dashboard-sign { break-after: page; page-break-after: always; box-shadow: none !important; }
        .dashboard-sign:last-of-type { break-after: auto; page-break-after: auto; }
      }
    `}</style>
  );
}
