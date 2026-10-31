// QR passes encode a link to the unit's public pass page, so an ordinary phone
// camera opens it. Marshal scanners extract the token from either the link or a
// bare token (passes printed before links were added).

const TOKEN = /^[0-9a-f]{32}$/;

export function passUrl(token: string, origin: string) {
  return `${origin.replace(/\/+$/, "")}/pass/${token}`;
}

export function extractPassToken(scanned: string): string | null {
  const text = scanned.trim();
  if (TOKEN.test(text)) return text;
  const m = text.match(/\/pass\/([0-9a-f]{32})(?:[/?#]|$)/);
  return m ? m[1] : null;
}
