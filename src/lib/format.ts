const TZ = "America/New_York";

export function formatDateTime(value: string | null | undefined, timeZone = TZ) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(value),
  );
}

export function formatDate(value: string | null | undefined, timeZone = TZ) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone }).format(new Date(value));
}

export function feet(n: number | string | null | undefined) {
  if (n === null || n === undefined || n === "") return null;
  return `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 })} ft`;
}

/** Value for <input type="datetime-local"> in the event's time zone. */
export function toLocalInput(value: string | null | undefined, timeZone = TZ) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Parse a datetime-local value entered in the event's time zone into an ISO string. */
export function fromLocalInput(value: string | null | undefined, timeZone = TZ) {
  if (!value) return null;
  const asUtc = new Date(`${value}:00Z`);
  // Offset of the time zone at that instant, applied once (adequate outside DST changeover hour).
  const local = new Date(asUtc.toLocaleString("en-US", { timeZone }));
  const utc = new Date(asUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(asUtc.getTime() + (utc.getTime() - local.getTime())).toISOString();
}
