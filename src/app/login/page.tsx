import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-4 py-10">
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
