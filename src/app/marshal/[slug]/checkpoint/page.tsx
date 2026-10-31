import { requireStaffEvent } from "@/lib/data";
import { CheckpointApp } from "./checkpoint-app";

export default async function CheckpointPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await requireStaffEvent(slug);
  return <CheckpointApp eventId={event.id} />;
}
