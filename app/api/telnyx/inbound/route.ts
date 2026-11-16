import { after } from "next/server";
import { last4 } from "@/lib/format";
import { parseInbound } from "@/lib/pairing";
import { classify } from "@/lib/status";
import {
  claimPairing,
  firstSeen,
  numberHash,
  pushFeed,
  setOptOut,
  setSession,
  setStatus,
  type FeedItem,
} from "@/lib/store";
import { sendSms, TelnyxError, verifyTelnyxWebhook } from "@/lib/telnyx";

/**
 * Inbound SMS + delivery receipts from Telnyx.
 *
 * The integration points your messaging profile here when you connect the
 * number to this project (TELNYX_MESSAGING_WEBHOOK_URL holds the URL).
 *
 * Rules that matter:
 *  - Verify the signature first and fail closed (401). Never trust the body.
 *  - Answer 2xx within 2 seconds; Telnyx retries and fails over otherwise.
 *    Only the PONG reply is awaited here; the rest runs in `after()`, once
 *    the response has gone.
 *  - Retries and failover can deliver the same event twice: dedupe on data.id.
 *    The Map below is a fast per-instance check; the cache check works across
 *    instances.
 *  - Don't reply to STOP, START or HELP. Telnyx handles them on the messaging
 *    profile and sends the confirmation text itself.
 */
const seen = new Map<string, number>();
function alreadySeen(id: string): boolean {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 10 * 60_000) seen.delete(k);
  if (seen.has(id)) return true;
  seen.set(id, now);
  return false;
}

type TelnyxEvent = {
  data?: {
    id?: string;
    event_type?: string;
    payload?: {
      id?: string;
      from?: { phone_number?: string };
      text?: string;
      autoresponse_type?: string;
      to?: { status?: string }[];
      errors?: { code?: string; title?: string; detail?: string }[];
    };
  };
};

const PONG = "PONG from your Vercel project";

export async function POST(req: Request) {
  if (!process.env.TELNYX_PUBLIC_KEY) {
    console.error("TELNYX_PUBLIC_KEY isn't set, so every webhook is refused. Connect the phone number to this project and redeploy.");
  }
  // Verify against the exact raw body: parsing it first would break the signature.
  const raw = await req.text();
  let event: TelnyxEvent | null;
  try {
    event = await verifyTelnyxWebhook<TelnyxEvent>(raw, req.headers);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!event) return new Response("invalid signature", { status: 401 });
  const id = event.data?.id;
  const eventType = event.data?.event_type;
  const payload = event.data?.payload ?? {};
  if (!id || !eventType) return Response.json({ ok: true, ignored: true });
  if (alreadySeen(id) || !(await firstSeen(id))) return Response.json({ ok: true, duplicate: true });

  if (eventType !== "message.received") {
    // message.sent / message.finalized: delivery receipts for what you sent.
    const status = payload.to?.[0]?.status;
    console.log("telnyx event", eventType, status);
    const messageId = payload.id;
    if (messageId) after(() => setStatus(messageId, classify({ status, errors: payload.errors })));
    return Response.json({ ok: true });
  }

  const from = payload.from?.phone_number;
  const text = payload.text ?? "";
  const { kind, codes } = parseInbound(text, payload.autoresponse_type);
  // Log the last 4 digits only: function logs are often shared.
  console.log("inbound sms", last4(from), kind);
  if (!from) return Response.json({ ok: true });

  const now = Date.now();
  const shown = last4(from);
  const nh = numberHash(from);
  const items: FeedItem[] = [
    { id, dir: "in", last4: shown, nh, text, at: now, ...(kind === "ping" || kind === "text" ? {} : { kind }) },
  ];

  // Example: reply PONG to an inbound "PING". Replace with your own logic.
  // Replies go to US numbers only (the messaging profile allows US
  // destinations only). Before your 10DLC campaign is approved, US carriers
  // block the reply to ordinary US mobiles; it still reaches Telnyx numbers.
  let pong: { id: string; status: ReturnType<typeof classify> } | null = null;
  if (kind === "ping") {
    // Await the reply: Vercel stops the function soon after the response is
    // sent, and the reply is the part that must not be lost.
    try {
      const msg = await sendSms(from, PONG);
      if (msg.id) pong = { id: msg.id, status: classify({ status: msg.to?.[0]?.status }) };
    } catch (e) {
      console.error("PONG reply failed", e instanceof Error ? e.message : e);
      if (e instanceof TelnyxError) pong = { id: `${id}:pong`, status: classify({ syncError: e }) };
    }
    if (pong) items.unshift({ id: pong.id, dir: "out", last4: shown, nh, text: PONG, at: now, kind: "pong" });
  }

  after(async () => {
    if (kind === "stop") await setOptOut(from, true);
    if (kind === "start") await setOptOut(from, false);
    for (const code of codes) {
      const sid = await claimPairing(code);
      if (sid) {
        await setSession(sid, from, shown);
        break;
      }
    }
    if (pong) await setStatus(pong.id, pong.status);
    await pushFeed(items);
  });
  return Response.json({ ok: true });
}
