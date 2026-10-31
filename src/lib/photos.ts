import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Short-lived URLs for photos the caller may see (RLS decides which). */
export async function signedPhotoUrls(paths: string[], seconds = 3600) {
  if (paths.length === 0) return new Map<string, string>();
  const supabase = await createClient();
  const { data } = await supabase.storage.from("event-photos").createSignedUrls(paths, seconds);
  return new Map<string, string>(
    (data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]),
  );
}
