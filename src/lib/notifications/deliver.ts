import "server-only";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// Delivers queued notifications. Runs with the service role (server only):
// from the Vercel cron route, or when a director presses "Deliver now".
// Providers are optional; without one, messages stay pending.

export function providerStatus() {
  return {
    email: Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL),
    sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
    worker: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

interface Pending {
  id: string;
  channel: "email" | "sms" | "in_app";
  subject: string;
  body: string;
  recipient_address: string | null;
  profiles: { email: string | null; phone: string | null } | null;
}

async function sendEmail(to: string, subject: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.NOTIFICATION_FROM_EMAIL, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`Email provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM_NUMBER!, Body: body.slice(0, 1500) }),
  });
  if (!res.ok) throw new Error(`SMS provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function deliverPending(eventId?: string, limit = 100) {
  const status = providerStatus();
  if (!status.worker) return { sent: 0, failed: 0, skipped: 0, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };

  const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  let q = db
    .from("notifications")
    .select("id, channel, subject, body, recipient_address, profiles:recipient_id(email, phone)")
    .eq("status", "pending")
    .in("channel", ["email", "sms"])
    .order("created_at")
    .limit(limit);
  if (eventId) q = q.eq("event_id", eventId);
  const { data, error } = await q.returns<Pending[]>();
  if (error) return { sent: 0, failed: 0, skipped: 0, error: error.message };

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const n of data ?? []) {
    // SMS falls back to email when no SMS provider or phone number is available.
    const phone = n.channel === "sms" ? (n.recipient_address ?? n.profiles?.phone) : null;
    const useSms = n.channel === "sms" && status.sms && phone;
    const email = n.channel === "email" ? (n.recipient_address ?? n.profiles?.email) : n.profiles?.email;
    if (!useSms && !(status.email && email)) {
      skipped++;
      continue;
    }
    try {
      if (useSms) await sendSms(phone!, `${n.subject}\n${n.body}`);
      else await sendEmail(email!, n.subject, n.body);
      await db.from("notifications").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", n.id);
      sent++;
    } catch (e) {
      await db
        .from("notifications")
        .update({ status: "failed", error: e instanceof Error ? e.message : String(e) })
        .eq("id", n.id);
      failed++;
    }
  }
  return { sent, failed, skipped };
}
