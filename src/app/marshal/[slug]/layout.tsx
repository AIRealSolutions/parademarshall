import Link from "next/link";
import { requireStaffEvent } from "@/lib/data";

export default async function MarshalLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { event } = await requireStaffEvent(slug);
  return (
    <div className="mx-auto max-w-xl px-3 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link href={`/marshal/${slug}`} className="font-semibold">
          {event.year} {event.name}
        </Link>
        {event.parade_hold && <span className="rounded bg-accent px-2 py-1 text-xs font-bold text-white">PARADE HOLD</span>}
      </div>
      {children}
    </div>
  );
}
