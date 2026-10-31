import { notFound } from "next/navigation";
import { requireStaffEvent } from "@/lib/data";
import { ADMIN_SECTIONS } from "@/lib/admin-nav";
import { Card, PageHeader } from "@/components/ui";

// Sections planned for later phases (SDS §9). Built sections have their own routes.
export default async function PlannedSection({ params }: { params: Promise<{ slug: string; section: string }> }) {
  const { slug, section } = await params;
  await requireStaffEvent(slug);
  const s = ADMIN_SECTIONS.find((x) => x.slug === section && x.phase);
  if (!s) notFound();
  return (
    <>
      <PageHeader title={s.label} subtitle={`Planned for Phase ${s.phase}`} />
      <Card>
        <p className="text-sm">{s.summary}</p>
        <p className="mt-3 text-sm text-muted">
          The database rules for this area are already in place, so this screen will plug into the existing data model.
        </p>
      </Card>
    </>
  );
}
