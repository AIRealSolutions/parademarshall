"use client";

import { useActionState, useState } from "react";
import { transitionApplication, type TransitionState } from "@/app/my/actions/transition";
import { Notice, buttonClass } from "@/components/ui";
import { STATUS_LABELS, requiresNote, type ApplicationStatus } from "@/lib/domain/applications";

const ACTION_LABELS: Partial<Record<ApplicationStatus, string>> = {
  under_review: "Start review",
  needs_information: "Request information",
  approved: "Approve",
  waitlisted: "Waitlist",
  rejected: "Reject",
  withdrawn: "Withdraw on participant's behalf",
  no_show: "Mark no-show",
  completed: "Mark completed",
};

const VARIANT: Partial<Record<ApplicationStatus, "primary" | "secondary" | "danger">> = {
  approved: "primary",
  under_review: "primary",
  rejected: "danger",
  withdrawn: "danger",
  no_show: "danger",
};

export function ReviewPanel({
  applicationId,
  status,
  transitions,
}: {
  applicationId: string;
  status: ApplicationStatus;
  transitions: ApplicationStatus[];
}) {
  const [state, action, pending] = useActionState<TransitionState, FormData>(transitionApplication, {});
  const [selected, setSelected] = useState<ApplicationStatus | null>(null);

  if (transitions.length === 0) {
    return <p className="text-sm text-muted">No review actions are available to you at this stage.</p>;
  }

  const noteRequired = selected ? requiresNote(status, selected) : false;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="to" value={selected ?? ""} />
      <div className="flex flex-wrap gap-2">
        {transitions.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSelected(t)}
            aria-pressed={selected === t}
            className={`${buttonClass(VARIANT[t] ?? "secondary")} ${selected === t ? "ring-2 ring-offset-2 ring-brand" : ""}`}
          >
            {ACTION_LABELS[t] ?? STATUS_LABELS[t]}
          </button>
        ))}
      </div>
      {selected && (
        <div className="space-y-2 rounded-md border border-border bg-stone-50 p-3">
          <label htmlFor="note" className="block text-sm font-medium">
            {noteRequired ? "Message to the participant (required)" : "Note (optional, emailed to the participant)"}
          </label>
          <textarea id="note" name="note" rows={3} className="input" required={noteRequired} />
          <div className="flex gap-2">
            <button className={buttonClass(VARIANT[selected] ?? "primary")} disabled={pending}>
              {pending ? "Saving…" : `Confirm: ${ACTION_LABELS[selected] ?? STATUS_LABELS[selected]}`}
            </button>
            <button type="button" className={buttonClass("secondary")} onClick={() => setSelected(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      {state.ok && <Notice tone="good">Status updated.</Notice>}
    </form>
  );
}
