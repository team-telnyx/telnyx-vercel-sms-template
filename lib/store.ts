/**
 * Where the live demo keeps its state: Vercel Runtime Cache.
 *
 * - No setup: it's built into Vercel Functions on every plan, and falls back
 *   to an in-memory cache under `next dev`.
 * - Ephemeral: entries expire (24 hours at most here) and can be evicted
 *   early. That suits a demo feed. To keep messages for real, swap this file
 *   for a database or Redis; nothing else imports the cache.
 * - Per region and per environment: preview deployments don't see the
 *   production webhook's messages.
 *
 * Privacy: keys are SHA-256 hashed, so phone numbers never appear in cache
 * keys, and each entry's observability name is only its kind ("feed", "msg").
 *
 * A `get` that returns null means "unknown" (missing, expired, or the cache
 * timed out). It never means "clear what the page shows".
 */
import crypto from "node:crypto";
import { getCache, type RuntimeCache } from "@vercel/functions";
import type { Classified } from "./status";
import { shouldReplace } from "./status";
import { DAY_S, FEED_MAX, MAX_TEXT, OPT_OUT_TTL_S, PAIR_TTL_S } from "./limits";
import { newCode } from "./pairing";

export type FeedKind = "pong" | "stop" | "start" | "help";

export type FeedItem = {
  /** Telnyx message id for texts this app sent, the webhook event id for texts it received. */
  id: string;
  dir: "in" | "out";
  last4: string;
  /** A hash of the phone number, so the feed can show a text only to the browser paired with that phone. */
  nh: string;
  text: string;
  at: number;
  kind?: FeedKind;
};

export type Feed = { ver: number; items: FeedItem[] };
export type Session = { number: string; last4: string; pairedAt: number };
export type StoredStatus = Classified & { at: number };

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * One namespace per phone number. On Hobby every project in a team shares one
 * cache, so this keeps projects apart. Digits only: the namespace isn't hashed.
 */
function namespace(): string {
  return `tsms${(process.env.TELNYX_PHONE_NUMBER ?? "none").replace(/\D/g, "")}`;
}

/**
 * The key the cache actually stores: `<namespace>$<sha256>`. SHA-256 rather
 * than the package's default 32-bit hash, so keys don't collide and contain
 * no characters that need escaping in the cache's URL.
 */
export const cacheKey = (key: string) => `${namespace()}$${sha256(key).slice(0, 40)}`;

let override: RuntimeCache | null = null;
/** Tests swap in their own cache. */
export function setCacheForTests(cache: RuntimeCache | null) {
  override = cache;
}
function cache(): RuntimeCache {
  // Keys arrive already hashed (cacheKey), so the package's own hashing is off.
  return override ?? getCache({ keyHashFunction: (k) => k });
}

/** "feed", "msg:abc" -> name "msg". Never the raw key, which can contain a number. */
const kindOf = (key: string) => key.split(":")[0];

async function get<T>(key: string): Promise<T | null> {
  try {
    return ((await cache().get(cacheKey(key))) as T | null) ?? null;
  } catch {
    return null;
  }
}
async function set(key: string, value: unknown, ttl: number): Promise<void> {
  try {
    await cache().set(cacheKey(key), value, { ttl, name: kindOf(key) });
  } catch {
    // Best effort, like the cache itself.
  }
}
async function del(key: string): Promise<void> {
  try {
    await cache().delete(cacheKey(key));
  } catch {
    // Best effort.
  }
}

/** A stable, non-reversible id for a phone number, used inside the feed only. */
export function numberHash(n: string): string {
  return sha256(`number:${n}`).slice(0, 16);
}

// Feed --------------------------------------------------------------------

export const getFeed = () => get<Feed>("feed");

/**
 * Add items to the top of the feed.
 *
 * Known race: this is read-modify-write, so two writes in the same few
 * milliseconds (a text arriving while the page sends one) can drop one item.
 * That's cosmetic for a demo. A store with atomic list operations fixes it.
 */
export async function pushFeed(items: FeedItem[]): Promise<void> {
  if (!items.length) return;
  const prev = await getFeed();
  const fresh = items.map((i) => ({ ...i, text: i.text.slice(0, MAX_TEXT) }));
  const known = new Set(fresh.map((i) => i.id));
  const merged = [...fresh, ...(prev?.items ?? []).filter((i) => !known.has(i.id))]
    .sort((a, b) => b.at - a.at)
    .slice(0, FEED_MAX);
  const ver = Math.max(Date.now(), (prev?.ver ?? 0) + 1);
  await set("feed", { ver, items: merged } satisfies Feed, DAY_S);
}

// Delivery status ---------------------------------------------------------

export const getStatus = (messageId: string) => get<StoredStatus>(`msg:${messageId}`);

/** Forward-only: a receipt that arrives late never moves a status backwards. */
export async function setStatus(messageId: string, status: Classified): Promise<void> {
  const prev = await getStatus(messageId);
  if (!shouldReplace(prev, status)) return;
  await set(`msg:${messageId}`, { ...status, at: Date.now() } satisfies StoredStatus, DAY_S);
}

/** The status fallback (asking Telnyx directly) runs at most once per message. */
export const wasRetrieved = async (messageId: string) => (await get(`ret:${messageId}`)) !== null;
export const markRetrieved = (messageId: string) => set(`ret:${messageId}`, 1, DAY_S);

// Pairing -----------------------------------------------------------------

/** Issue a pairing code for this browser, or return the one it already has. */
export async function newPairing(sid: string): Promise<{ code: string; expiresAt: number }> {
  const existing = await get<{ code: string; expiresAt: number }>(`code:${sid}`);
  if (existing && existing.expiresAt > Date.now() + 30_000) return existing;
  const code = newCode();
  const expiresAt = Date.now() + PAIR_TTL_S * 1000;
  await set(`pair:${code}`, sid, PAIR_TTL_S);
  await set(`code:${sid}`, { code, expiresAt }, PAIR_TTL_S);
  return { code, expiresAt };
}

/** Single use: claiming a code deletes it, so nobody else can re-point the browser. */
export async function claimPairing(code: string): Promise<string | null> {
  const sid = await get<string>(`pair:${code}`);
  if (!sid) return null;
  await del(`pair:${code}`);
  await del(`code:${sid}`);
  return sid;
}

export const getSession = (sid: string) => get<Session>(`sess:${sid}`);

export async function setSession(sid: string, number: string, shown: string): Promise<void> {
  await set(`sess:${sid}`, { number, last4: shown, pairedAt: Date.now() } satisfies Session, DAY_S);
}

// Dedupe, opt-out, limits -------------------------------------------------

/** True the first time an event id is seen (across function instances, unlike an in-memory Map). */
export async function firstSeen(eventId: string): Promise<boolean> {
  if ((await get(`seen:${eventId}`)) !== null) return false;
  await set(`seen:${eventId}`, 1, 600);
  return true;
}

/** Local opt-out flag. Telnyx's own block (error 40300) is the one that counts. */
export const isOptedOut = async (n: string) => (await get(`optout:${n}`)) !== null;
export async function setOptOut(n: string, on: boolean): Promise<void> {
  if (on) await set(`optout:${n}`, 1, OPT_OUT_TTL_S);
  else await del(`optout:${n}`);
}

/** Best-effort counters (not atomic). An unknown count reads as 0. */
export const count = async (key: string) => (await get<number>(key)) ?? 0;
export async function bump(key: string, ttl: number): Promise<number> {
  const next = (await count(key)) + 1;
  await set(key, next, ttl);
  return next;
}
