"use client";

import { useActionState } from "react";
import { transitionApplication, type TransitionState } from "@/app/my/actions/transition";
import { buttonClass } from "@/components/ui";

export function TransitionButton({
  applicationId,
  to,
  label,
  variant = "secondary",
  confirm,
}: {
  applicationId: string;
  to: string;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
}) {
  const [state, action, pending] = useActionState<TransitionState, FormData>(transitionApplication, {});
  return (
    <form
      action={action}
      onSubmit={(ev) => {
        if (confirm && !window.confirm(confirm)) ev.preventDefault();
      }}
    >
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="to" value={to} />
      <button className={buttonClass(variant)} disabled={pending}>
        {pending ? "Working…" : label}
      </button>
      {state.error && <p className="mt-1 text-xs text-accent">{state.error}</p>}
    </form>
  );
}
