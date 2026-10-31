"use client";

import QRCode from "qrcode";
import { useState } from "react";
import { buttonClass } from "@/components/ui";

/** Saves the pass as a phone-friendly image (for staging areas without signal). */
export function SavePassImage({
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
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const W = 1080;
      const H = 1600;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, W, H);
      // Chevron bands, as on the site.
      for (const y of [0, H - 50]) {
        g.save();
        g.beginPath();
        g.rect(0, y, W, 50);
        g.clip();
        for (let i = 0, x = -112; x < W + 112; i++, x += 28) {
          g.fillStyle = i % 2 === 0 ? "#b3261e" : "#f2b705";
          g.beginPath();
          g.moveTo(x, y + 50);
          g.lineTo(x + 28, y + 50);
          g.lineTo(x + 78, y);
          g.lineTo(x + 50, y);
          g.fill();
        }
        g.restore();
      }
      g.fillStyle = "#111";
      g.textAlign = "center";
      g.font = "600 44px system-ui, sans-serif";
      g.fillText(eventTitle, W / 2, 130);
      g.font = "800 40px system-ui, sans-serif";
      g.fillText("PARADE UNIT", W / 2, 230);
      g.font = "900 230px system-ui, sans-serif";
      g.fillText(sequence === null ? "TBD" : String(sequence), W / 2, 450);
      g.font = "700 56px system-ui, sans-serif";
      g.fillText(unitName.length > 30 ? unitName.slice(0, 29) + "…" : unitName, W / 2, 550);

      const qr = document.createElement("canvas");
      await QRCode.toCanvas(qr, url, { width: 640, margin: 2, errorCorrectionLevel: "M" });
      g.drawImage(qr, (W - 640) / 2, 610);

      g.font = "500 40px system-ui, sans-serif";
      if (staging) g.fillText(`Staging: ${staging}`, W / 2, 1330);
      g.font = "400 34px system-ui, sans-serif";
      g.fillStyle = "#555";
      g.fillText("Show this to a staging marshal when you arrive", W / 2, 1410);

      const blob: Blob = await new Promise((resolve) => c.toBlob((b) => resolve(b!), "image/png"));
      const name = `parade-pass-${sequence ?? "unit"}.png`;
      const file = new File([blob], name, { type: "image/png" });
      // Phones: the share sheet offers "Save Image" to Photos. Desktops: download.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${unitName} parade pass` }).catch(() => {});
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className={buttonClass("secondary")} onClick={save} disabled={busy}>
      {busy ? "Preparing…" : "Save as image"}
    </button>
  );
}
