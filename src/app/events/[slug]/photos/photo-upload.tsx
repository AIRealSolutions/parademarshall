"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordPhotoSubmission } from "@/lib/actions/engagement";
import { Notice, buttonClass } from "@/components/ui";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export function PhotoUpload({
  eventId,
  userId,
  units,
}: {
  eventId: string;
  userId: string;
  units: { unit_id: string; sequence: number; name: string }[];
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [v, setV] = useState({ caption: "", credit_name: "", unit_id: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!file) return setError("Choose a photo.");
    if (!TYPES.includes(file.type)) return setError("Use a JPEG, PNG, WebP or HEIC photo.");
    if (file.size > MAX_BYTES) return setError("Photos must be 10 MB or smaller.");

    setBusy(true);
    const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${eventId}/${userId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await createClient()
      .storage.from("event-photos")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      setBusy(false);
      return setError(upErr.message);
    }
    const r = await recordPhotoSubmission({ event_id: eventId, storage_path: path, ...v, unit_id: v.unit_id || null });
    setBusy(false);
    if (r.error) return setError(r.error);
    setDone(true);
    setFile(null);
    setV({ caption: "", credit_name: "", unit_id: "" });
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        type="file"
        accept={TYPES.join(",")}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-2 file:text-white"
        aria-label="Photo"
      />
      <input className="input text-sm" placeholder="Caption (optional)" maxLength={300} value={v.caption} onChange={(e) => setV({ ...v, caption: e.target.value })} />
      <input className="input text-sm" placeholder="Photo credit (optional)" maxLength={100} value={v.credit_name} onChange={(e) => setV({ ...v, credit_name: e.target.value })} />
      {units.length > 0 && (
        <select className="input text-sm" value={v.unit_id} onChange={(e) => setV({ ...v, unit_id: e.target.value })} aria-label="Parade unit in the photo">
          <option value="">Which unit is this? (optional)</option>
          {units.map((u) => (
            <option key={u.unit_id} value={u.unit_id}>
              {u.sequence}. {u.name}
            </option>
          ))}
        </select>
      )}
      <p className="text-xs text-muted">By sharing, you confirm you took this photo and allow the parade to display it.</p>
      {error && <Notice tone="bad">{error}</Notice>}
      {done && <Notice tone="good">Thanks! Your photo will appear after review.</Notice>}
      <button className={`${buttonClass()} w-full`} disabled={busy}>
        {busy ? "Uploading…" : "Submit photo"}
      </button>
    </form>
  );
}
