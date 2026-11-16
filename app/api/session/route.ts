import { PAIR_TTL_S } from "@/lib/limits";
import { formatUs, qrPayload, smsHref } from "@/lib/format";
import { qrSvg } from "@/lib/qr";
import { readSid, newSid, sidCookie } from "@/lib/session";
import { getSession, newPairing } from "@/lib/store";
import { US_E164 } from "@/lib/telnyx";

export const dynamic = "force-dynamic";

/**
 * POST -> this browser's pairing code, plus the Messages link and QR code
 * that pre-fill "PING <code>".
 *
 * POST, not GET, so link previews and crawlers never create codes (each one
 * is a cache write). The page calls it from the browser once it's visible.
 * A browser that's already paired gets no new code: codes are single use, and
 * only the person looking at this page can see one.
 */
export async function POST(req: Request) {
  const number = process.env.TELNYX_PHONE_NUMBER;
  if (!number) return Response.json({ error: "TELNYX_PHONE_NUMBER isn't set." }, { status: 503, headers: noStore });

  let sid = readSid(req);
  const headers = new Headers(noStore);
  if (!sid) {
    sid = newSid();
    headers.set("set-cookie", sidCookie(sid, req));
  }

  const session = await getSession(sid);
  const pairing = session ? null : await newPairing(sid);
  const code = pairing?.code ?? null;
  const ua = req.headers.get("user-agent") ?? "";
  const svg = await qrSvg(qrPayload(number, code));

  return Response.json(
    {
      code,
      expiresAt: pairing?.expiresAt ?? null,
      ttl: PAIR_TTL_S,
      smsHref: smsHref(number, code, ua),
      qrSvg: svg,
      qrAlt: `QR code that opens Messages with ${code ? `PING ${code}` : "PING"} to ${formatUs(number)}`,
      paired: session ? { last4: session.last4, canSend: US_E164.test(session.number) } : null,
    },
    { headers },
  );
}

export function GET() {
  return new Response("Use POST.", { status: 405, headers: { allow: "POST" } });
}

const noStore = { "cache-control": "no-store" };
