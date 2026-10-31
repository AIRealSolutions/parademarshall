"use client";

import { buttonClass } from "@/components/ui";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button className={`${buttonClass("secondary")} print:hidden`} onClick={() => window.print()}>
      {label}
    </button>
  );
}
