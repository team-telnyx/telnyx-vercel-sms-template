/**
 * The numbers that keep the demo cheap and safe on a public URL.
 * Change them here; nothing else hard-codes them.
 */

/** Texts the page may send to one paired phone in a rolling window. */
export const PER_NUMBER_SENDS = 3;
export const PER_NUMBER_WINDOW_MS = 10 * 60_000;

/** Texts this deployment may send per UTC day from the page. Override with DAILY_SEND_LIMIT. */
export function dailySends(): number {
  return Number(process.env.DAILY_SEND_LIMIT) || 25;
}

/** One SMS segment. */
export const MAX_TEXT = 160;

/** How many messages the live feed keeps. */
export const FEED_MAX = 20;

/** How long a pairing code stays valid, in seconds. */
export const PAIR_TTL_S = 15 * 60;

/** How long messages, sessions and statuses are kept, in seconds. */
export const DAY_S = 24 * 60 * 60;

/** How long an opt-out is remembered locally, in seconds. Telnyx keeps its own, permanent block. */
export const OPT_OUT_TTL_S = 30 * DAY_S;

/** Wait this long for a delivery receipt before asking Telnyx for the status directly. */
export function receiptGraceMs(): number {
  const raw = process.env.RECEIPT_GRACE_MS;
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : 15_000;
}
