import { sendSms, verifyTelnyxSignature } from "@/lib/telnyx";

/**
 * Inbound SMS + delivery receipts from Telnyx.
 *
 * Rules that matter:
 *  - Verify the signature first and fail closed (401). Never trust the body.
 *  - Answer 2xx within 2 seconds; Telnyx retries and fails over otherwise.
 *    Do slow work after responding (queue it, or keep it short like here).
 *  - Retries and failover can deliver the same event twice: dedupe on data.id.
 */
const seen = new Map<string, number>();
function alreadySeen(id: string): boolean {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 10 * 60_000) seen.delete(k);
  if (seen.has(id)) return true;
  seen.set(id, now);
  return false;
}

export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifyTelnyxSignature(
    raw,
    req.headers.get("telnyx-signature-ed25519"),
    req.headers.get("telnyx-timestamp"),
  );
  if (!ok) return new Response("invalid signature", { status: 401 });

  const event = JSON.parse(raw) as {
    data: {
      id: string;
      event_type: string;
      payload: { from?: { phone_number: string }; text?: string; direction?: string };
    };
  };
  if (alreadySeen(event.data.id)) return Response.json({ ok: true, duplicate: true });

  const { event_type, payload } = event.data;
  console.log("telnyx event", event_type, payload.from?.phone_number, payload.text);

  // Example: reply to an inbound "PING". Replace with your own logic.
  if (event_type === "message.received" && payload.from && payload.text?.trim().toUpperCase() === "PING") {
    // Await the reply: Vercel stops the function once the response is sent,
    // so a fire-and-forget send would never go out.
    await sendSms(payload.from.phone_number, "PONG from your Vercel project").catch((e) =>
      console.error("reply failed", e),
    );
  }
  return Response.json({ ok: true });
}
