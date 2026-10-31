import { NextResponse, type NextRequest } from "next/server";
import { deliverPending } from "@/lib/notifications/deliver";

// Called by Vercel Cron (see vercel.json). Vercel sends the CRON_SECRET as a bearer token.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await deliverPending());
}
