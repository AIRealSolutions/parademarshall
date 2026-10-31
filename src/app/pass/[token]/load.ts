import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UnitPass } from "@/lib/domain/pass";

export const loadPass = cache(async (token: string) => {
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_unit_pass", { p_token: token });
  if (!data) notFound();
  return data as UnitPass;
});
