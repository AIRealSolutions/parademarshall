import Link from "next/link";
import { getUser } from "@/lib/data";

export async function SiteHeader() {
  const user = await getUser();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold text-brand">
          <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-accent" />
          Parade Marshal
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href="/my" className="hover:underline">
                My entries
              </Link>
              <Link href="/admin" className="hover:underline">
                Staff
              </Link>
              <form action="/auth/signout" method="post">
                <button className="text-muted hover:underline">Sign out</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="hover:underline">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
