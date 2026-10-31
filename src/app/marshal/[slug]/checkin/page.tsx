import { requireStaffEvent } from "@/lib/data";
import { CheckInApp } from "./check-in-app";

export default async function CheckInPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await requireStaffEvent(slug);
  return <CheckInApp eventId={event.id} />;
}
