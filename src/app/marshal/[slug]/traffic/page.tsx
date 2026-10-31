import { requireStaffEvent } from "@/lib/data";
import { TrafficApp } from "./traffic-app";

export default async function TrafficPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await requireStaffEvent(slug);
  return <TrafficApp eventId={event.id} timezone={event.timezone} />;
}
