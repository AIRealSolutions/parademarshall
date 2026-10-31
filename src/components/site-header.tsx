import Image from "next/image";
import Link from "next/link";
import icon from "@/app/icon.png";
import { getUser } from "@/lib/data";

export async function SiteHeader() {
  const user = await getUser();
  return (
    <header className="bg-surface print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold text-brand">
          <Image src={icon} alt="" width={28} height={28} className="rounded-md" priority />
          Parade Marshal
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href="/my" className="hover:underline">
                My entries
              </Link>
              <Link href="/marshal" className="hover:underline">
                Marshal
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
      <div className="chevron-stripe h-1.5" aria-hidden />
    </header>
  );
}
