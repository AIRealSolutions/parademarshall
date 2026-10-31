import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEventBySlug, registrationOpen, requireUser } from "@/lib/data";
import { loadFormOptions } from "@/lib/form-options";
import { ApplicationForm } from "@/components/application-form";
import { Notice, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Register an entry" };

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser(`/events/${slug}/register`);
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  if (!registrationOpen(event)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <PageHeader title={`${event.year} ${event.name}`} />
        <Notice tone="warn">Registration is not open for this event.</Notice>
      </main>
    );
  }

  const options = await loadFormOptions(event, user.id);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        title="Register a parade entry"
        subtitle={`${event.year} ${event.name}. You can save a draft and finish later. Every entry is reviewed by the parade committee.`}
      />
      <ApplicationForm options={options} />
    </main>
  );
}
