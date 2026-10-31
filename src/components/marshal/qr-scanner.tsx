"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

/** Camera QR scanner. Calls onScan once per distinct code, then keeps scanning. */
export function QrScanner({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ text: string; at: number } | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (stopped || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        tick();
      } catch (e) {
        setError(e instanceof Error && e.name === "NotAllowedError" ? "Camera permission was denied." : "Camera unavailable on this device.");
      }
    }

    function tick() {
      if (stopped) return;
      const v = video.current;
      const c = canvas.current;
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const img = ctx.getImageData(0, 0, c.width, c.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          const now = Date.now();
          if (code?.data && (last.current?.text !== code.data || now - last.current.at > 4000)) {
            last.current = { text: code.data, at: now };
            navigator.vibrate?.(80);
            onScanRef.current(code.data.trim());
          }
        }
      }
      frame = requestAnimationFrame(tick);
    }

    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={video} className="aspect-square w-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-[18%] rounded-lg border-4 border-white/80" aria-hidden />
      </div>
      <canvas ref={canvas} className="hidden" />
      {error && <p className="text-sm text-accent">{error} Use the unit list below instead.</p>}
      <button className="w-full rounded-md border border-border bg-surface py-3 font-medium" onClick={onClose}>
        Close camera
      </button>
    </div>
  );
}
