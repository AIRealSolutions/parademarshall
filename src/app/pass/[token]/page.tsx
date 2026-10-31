import type { Metadata } from "next";
import QRCode from "qrcode";
import { passUrl } from "@/lib/pass";
import { siteOrigin } from "@/lib/site-origin";
import { PassView } from "@/components/pass/pass-view";
import { loadPass } from "./load";

// Pass links are private to the unit: keep them out of search engines and referrers.
export const metadata: Metadata = { title: "Parade pass", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PassPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pass = await loadPass(token);
  const url = passUrl(token, await siteOrigin());
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return <PassView pass={pass} token={token} url={url} svg={svg} />;
}
