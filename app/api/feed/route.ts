import { receiptGraceMs } from "@/lib/limits";
import { readSid } from "@/lib/session";
import { classify, isFinal, type Classified } from "@/lib/status";
import {
  getFeed,
  getSession,
  getStatus,
  markRetrieved,
  numberHash,
  setStatus,
  wasRetrieved,
  type FeedItem,
  type StoredStatus,
} from "@/lib/store";
import { getMessageStatus } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

/** What the browser gets for each message. `text` is only there for the paired phone's own messages. */
export type PublicItem = Omit<FeedItem, "nh" | "text"> & {
  text?: string;
  mine: boolean;
  status?: Pick<Classified, "key" | "stage" | "code" | "title">;
};

export type FeedResponse =
  | { preview: true; productionUrl: string | null }
  | {
      ver: number | null;
      unchanged?: true;
      items?: PublicItem[];
      paired: { last4: string } | null;
      region?: string;
    };

/** Outbound messages younger than this still wait for a final status. */
const PENDING_WINDOW_MS = 10 * 60_000;
/** At most this many direct status lookups per request. */
const MAX_LOOKUPS = 2;

/**
 * GET ?since=<ver> -> the live feed for the home page.
 *
 * Anyone with the link sees that texts arrived, with the number masked. Only
 * the browser paired with a phone sees that phone's message text.
 */
export async function GET(req: Request) {
  if (process.env.VERCEL_ENV === "preview") {
    const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    return json({ preview: true, productionUrl: prod ? `https://${prod}` : null });
  }

  const since = Number(new URL(req.url).searchParams.get("since")) || null;
  const sid = readSid(req);
  const [feed, session] = await Promise.all([getFeed(), sid ? getSession(sid) : Promise.resolve(null)]);
  const paired = session ? { last4: session.last4 } : null;
  if (!feed) return json({ ver: null, paired });

  const now = Date.now();
  const pending = (i: FeedItem) => i.dir === "out" && now - i.at < PENDING_WINDOW_MS;
  const statuses = new Map<string, StoredStatus | null>();
  await Promise.all(
    feed.items.filter(pending).map(async (i) => statuses.set(i.id, await getStatus(i.id))),
  );
  const stillPending = [...statuses.values()].some((s) => !isFinal(s?.key));
  // Receipts don't touch the feed itself, so the version also covers the newest receipt.
  const ver = Math.max(feed.ver, ...[...statuses.values()].map((s) => s?.at ?? 0));
  if (since === ver && !stillPending) return json({ ver, unchanged: true, paired });
  await Promise.all(
    feed.items
      .filter((i) => i.dir === "out" && !statuses.has(i.id))
      .map(async (i) => statuses.set(i.id, await getStatus(i.id))),
  );

  // Late receipt: ask Telnyx at most once a minute per message, a couple of messages per request.
  let lookups = 0;
  for (const i of feed.items) {
    if (lookups >= MAX_LOOKUPS) break;
    const s = statuses.get(i.id);
    if (!pending(i) || isFinal(s?.key) || now - i.at < receiptGraceMs()) continue;
    if (await wasRetrieved(i.id)) continue;
    lookups++;
    await markRetrieved(i.id);
    try {
      const r = await getMessageStatus(i.id);
      const next = classify(r);
      await setStatus(i.id, next);
      if (!s || next.rank >= s.rank) statuses.set(i.id, { ...next, at: Date.now() });
    } catch {
      // Keep what we have; the webhook may still arrive.
    }
  }

  const mine = session ? numberHash(session.number) : null;
  const items: PublicItem[] = feed.items.map(({ nh, text, ...rest }) => {
    const own = mine !== null && nh === mine;
    const s = rest.dir === "out" ? statuses.get(rest.id) : undefined;
    return {
      ...rest,
      mine: own,
      ...(own ? { text } : {}),
      ...(s ? { status: { key: s.key, stage: s.stage, code: s.code, title: s.title } } : {}),
    };
  });
  return json({ ver, items, paired, region: process.env.VERCEL_REGION });
}

function json(body: FeedResponse) {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
