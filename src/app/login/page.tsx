import type { Metadata } from "next";
import Image from "next/image";
import { Card } from "@/components/ui";
import { photos } from "@/lib/images";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="mx-auto grid max-w-5xl items-start gap-8 px-4 py-10 md:grid-cols-2">
      <div className="relative hidden aspect-[4/3] overflow-hidden rounded-xl md:block">
        <Image src={photos.families.src} alt={photos.families.alt} placeholder="blur" fill sizes="50vw" className="object-cover" />
        <div className="chevron-stripe absolute inset-x-0 bottom-0 h-1.5" aria-hidden />
      </div>
      <Card title="Sign in">
        <p className="mb-4 text-sm text-muted">
          Participants and staff sign in with a one-time link or code sent by email. No password needed. Spectators do
          not need an account.
        </p>
        <LoginForm next={next ?? "/my"} initialError={error === "link" ? "That sign-in link was invalid or expired." : error} />
      </Card>
    </main>
  );
}
