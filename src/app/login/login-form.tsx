"use client";

import { useActionState, useEffect, useState } from "react";
import { Field, Notice, buttonClass } from "@/components/ui";
import { sendMagicLink, verifyEmailCode, type LoginState } from "./actions";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});
  const [codeState, verify, verifying] = useActionState<LoginState, FormData>(verifyEmailCode, {});
  const [hashError, setHashError] = useState<string | null>(null);

  // Supabase reports some link failures (e.g. expired or already used) in the URL fragment.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const msg = params.get("error_description");
    if (msg) setHashError(msg.replace(/\+/g, " "));
  }, []);

  const error = state.error ?? hashError ?? initialError;
  const sentTo = codeState.sent ?? state.sent;

  if (sentTo) {
    return (
      <div className="space-y-4">
        <Notice tone="good">
          We emailed <strong>{sentTo}</strong>. Tap the link in the email. If your email shows a code, you can enter it
          below instead.
        </Notice>
        <form action={verify} className="space-y-3">
          <input type="hidden" name="email" value={sentTo} />
          <input type="hidden" name="next" value={state.next ?? codeState.next ?? next} />
          <Field label="Code from the email" htmlFor="token">
            <input
              id="token"
              name="token"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              className="input text-center font-mono text-xl tracking-[0.4em]"
              required
            />
          </Field>
          {codeState.error && <Notice tone="bad">{codeState.error}</Notice>}
          <button className={`${buttonClass()} w-full`} disabled={verifying}>
            {verifying ? "Checking…" : "Sign in with code"}
          </button>
        </form>
      </div>
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
      {error && (
        <Notice tone="bad">
          <p className="font-medium">Sign-in didn&apos;t complete</p>
          <p className="mt-1">{error}</p>
        </Notice>
      )}
      <button className={`${buttonClass()} w-full`} disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
