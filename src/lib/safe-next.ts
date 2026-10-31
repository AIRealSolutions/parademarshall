/** Only allow same-site relative redirects after sign-in. */
export function safeNext(next: unknown, fallback = "/my") {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
