import { sendSms, verifyTelnyxSignature } from "@/lib/telnyx";

/**
 * Inbound SMS + delivery receipts from Telnyx.
 *
 * The integration points your messaging profile here when you connect the
 * number to this project (TELNYX_MESSAGING_WEBHOOK_URL holds the URL).
 *
 * Rules that matter:
 *  - Verify the signature first and fail closed (401). Never trust the body.
 *  - Answer 2xx within 2 seconds; Telnyx retries and fails over otherwise.
 *    Keep the work short (like here) or hand it to a queue.
 *  - Retries and failover can deliver the same event twice: dedupe on data.id.
 *    The in-memory set below is per function instance, so it is best effort;
 *    use a store (Redis, a database) when duplicates matter.
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
    payload?: { from?: { phone_number?: string }; text?: string; to?: { status?: string }[] };
  };
};

export async function POST(req: Request) {
  if (!process.env.TELNYX_PUBLIC_KEY) {
    console.error("TELNYX_PUBLIC_KEY isn't set, so every webhook is refused. Connect the phone number to this project and redeploy.");
  }
  const raw = await req.text();
  const ok = verifyTelnyxSignature(
    raw,
    req.headers.get("telnyx-signature-ed25519"),
    req.headers.get("telnyx-timestamp"),
  );
  if (!ok) return new Response("invalid signature", { status: 401 });

  let event: TelnyxEvent;
  try {
    event = JSON.parse(raw) as TelnyxEvent;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const id = event.data?.id;
  const eventType = event.data?.event_type;
  const payload = event.data?.payload ?? {};
  if (!id || !eventType) return Response.json({ ok: true, ignored: true });
  if (alreadySeen(id)) return Response.json({ ok: true, duplicate: true });

  if (eventType === "message.received") {
    console.log("inbound sms", payload.from?.phone_number, payload.text);
  } else {
    // message.sent / message.finalized: delivery receipts for what you sent.
    console.log("telnyx event", eventType, payload.to?.[0]?.status);
  }

  // Example: reply PONG to an inbound "PING". Replace with your own logic.
  // Replies go to US numbers only (the messaging profile allows US
  // destinations only). Before your 10DLC campaign is approved, US carriers
  // block the reply to ordinary US mobiles; it still reaches Telnyx numbers.
  const from = payload.from?.phone_number;
  if (eventType === "message.received" && from && payload.text?.trim().toUpperCase() === "PING") {
    // Await the reply: Vercel stops the function once the response is sent,
    // so a fire-and-forget send would never go out.
    await sendSms(from, "PONG from your Vercel project").catch((e) =>
      console.error("PONG reply failed", e instanceof Error ? e.message : e),
    );
  }
  return Response.json({ ok: true });
}
