"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions/result";

/** Runs a server action, shows its error, and refreshes server data on success. */
export function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run<T>(fn: () => Promise<ActionResult<T>>, success?: string | ((data: T | undefined) => string)) {
    setError(null);
    setMessage(null);
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        const r = await fn();
        if (r.error) {
          setError(r.error);
          resolve(false);
        } else {
          if (success) setMessage(typeof success === "function" ? success(r.data) : success);
          router.refresh();
          resolve(true);
        }
      });
    });
  }

  return { run, pending, error, message, setError };
}
