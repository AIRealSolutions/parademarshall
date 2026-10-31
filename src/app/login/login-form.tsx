"use client";

import { useActionState } from "react";
import { Field, Notice, buttonClass } from "@/components/ui";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});

  if (state.sent) {
    return (
      <Notice tone="good">
        Check <strong>{state.sent}</strong> for a sign-in link. You can close this tab.
      </Notice>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email" required>
        <input id="email" name="email" type="email" autoComplete="email" required className="input" />
      </Field>
      <Field label="Your name" htmlFor="full_name" hint="Used on your profile the first time you sign in.">
        <input id="full_name" name="full_name" autoComplete="name" className="input" />
      </Field>
      {state.error && <Notice tone="bad">{state.error}</Notice>}
      <button className={`${buttonClass()} w-full`} disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
