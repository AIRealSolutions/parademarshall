import { requireStaffEvent } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { DispatchBoard } from "./dispatch-board";

export default async function DispatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event, access } = await requireStaffEvent(slug);
  const can = (...roles: string[]) => access.isSystemAdmin || access.roles.some((r) => roles.includes(r));
  return (
    <>
      <PageHeader title="Dispatch Center" subtitle="One active release authorization at the Bay/Howe merge at a time." />
      <DispatchBoard
        eventId={event.id}
        timezone={event.timezone}
        canDispatch={can("parade_director", "dispatch_controller")}
        canHold={can("parade_director", "dispatch_controller", "public_safety_liaison")}
        canStage={can("parade_director", "assistant_director", "staging_marshal", "dispatch_controller")}
      />
    </>
  );
}
