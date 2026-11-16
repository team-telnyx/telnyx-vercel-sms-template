/** Small formatting helpers shared by the server and the browser. */

/** "+14155550123" -> "•••0123". The only form of a phone number the page ever shows for other people. */
export function last4(n: string | null | undefined): string {
  const digits = (n ?? "").replace(/\D/g, "");
  return `•••${digits.slice(-4).padStart(4, "•")}`;
}

/** "+14155550123" -> "+1 (415) 555-0123". Other numbers are returned as they are. */
export function formatUs(n: string | null | undefined): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(n ?? "");
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : (n ?? "");
}

/** The text the visitor sends: PING plus this browser's pairing code. */
export function pingText(code: string | null | undefined): string {
  return code ? `PING ${code}` : "PING";
}

/**
 * A link that opens Messages with the number and the text filled in.
 * iOS fills the body from `sms:<n>&body=`, most other platforms from the
 * standard `sms:<n>?body=` (RFC 5724).
 */
export function smsHref(number: string, code: string | null | undefined, userAgent = ""): string {
  const body = encodeURIComponent(pingText(code));
  const ios = /iPhone|iPad|iPod/i.test(userAgent);
  return `sms:${number}${ios ? "&" : "?"}body=${body}`;
}

/** What the QR code encodes. Phone cameras on iOS and Android read SMSTO: codes as "send a text". */
export function qrPayload(number: string, code: string | null | undefined): string {
  return `SMSTO:${number}:${pingText(code)}`;
}

/** "just now", "3 min ago", "2 h ago". */
export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

/** Append `to=<target>` to a dashboard link, whether or not it already has a query. */
export function withTarget(url: string, to: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}to=${encodeURIComponent(to)}`;
}
