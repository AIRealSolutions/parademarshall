"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export interface LoginState {
  error?: string;
  sent?: string;
  next?: string;
}

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = z.string().trim().email().safeParse(formData.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  const next = safeNext(formData.get("next"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      data: { full_name: String(formData.get("full_name") ?? "").trim() },
    },
  });
  if (error) return { error: error.message };
  return { sent: email.data, next };
}

/** Sign in with the 6-digit code from the email; works on any device. */
export async function verifyEmailCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("token") ?? "").replace(/\s/g, "");
  const next = safeNext(formData.get("next"));
  if (!/^\d{6,10}$/.test(token)) return { sent: email, next, error: "Enter the code from the email." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { sent: email, next, error: error.message };
  redirect(next);
}
