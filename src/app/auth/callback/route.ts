import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

// Handles every link style Supabase can send:
//  - token hash:  ?token_hash=...&type=...  (custom email template; works on any device)
//  - PKCE:        ?code=...                 (must open in the browser that requested it)
//  - implicit:    #access_token=...         (default template; finished in /auth/complete)
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}&next=${encodeURIComponent(next)}`);

  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) return fail(providerError);

  const supabase = await createClient();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    return error ? fail(error.message) : NextResponse.redirect(`${origin}${next}`);
  }

  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    // The usual cause: the link was opened in a different browser or app than the one that asked for it.
    return fail(
      /verifier/i.test(error.message)
        ? "This link was opened in a different browser than the one you signed in from. Enter the 6-digit code from the email instead, or request a new link and open it in the same browser."
        : error.message,
    );
  }
  // Implicit-flow links put the session in the URL fragment, which only the browser
  // can read. The fragment survives this redirect, so the client page finishes sign-in.
  return NextResponse.redirect(`${origin}/auth/complete?next=${encodeURIComponent(next)}`);
}
