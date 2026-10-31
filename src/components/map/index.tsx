"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window`, so the map renders only in the browser.
export const ParadeMap = dynamic(() => import("./parade-map"), {
  ssr: false,
  loading: () => <div className="h-[28rem] animate-pulse rounded-lg border border-border bg-stone-100" />,
});

export type { DrawState, MapCheckpoint, MapRoute, ParadeMapProps } from "./parade-map";
