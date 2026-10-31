"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";

// Finishes an implicit-flow email sign-in: the session arrives in the URL
// fragment (never sent to the server), so the browser stores it as cookies.
export default function CompleteSignIn() {
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    const toLogin = (reason: string) =>
      window.location.replace(`/login?error=${encodeURIComponent(reason)}&next=${encodeURIComponent(next)}`);

    const error = hash.get("error_description") ?? hash.get("error");
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    if (error) return toLogin(error.replace(/\+/g, " "));
    if (!access_token || !refresh_token) return toLogin("The sign-in link was incomplete. Request a new one.");

    createClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error: e }) => {
        if (e) return toLogin(e.message);
        setMessage("Signed in. Redirecting…");
        // Full navigation so the server sees the new session cookies.
        window.location.replace(next);
      });
  }, []);

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <p className="text-lg" role="status">
        {message}
      </p>
    </main>
  );
}
