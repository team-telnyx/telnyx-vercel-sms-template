import { last4 } from "@/lib/format";
import { dailySends, DAY_S, MAX_TEXT, PER_NUMBER_SENDS, PER_NUMBER_WINDOW_MS } from "@/lib/limits";
import { readSid } from "@/lib/session";
import { classify } from "@/lib/status";
import { bump, count, getSession, isOptedOut, numberHash, pushFeed, setOptOut, setStatus } from "@/lib/store";
import { checkSendPassword, sendSms, TelnyxError, US_E164 } from "@/lib/telnyx";

/**
 * POST { text } -> texts the phone that paired with this browser.
 *
 * The recipient comes from the server-side session (the phone that texted
 * this browser's pairing code), never from the request, so a stranger who
 * opens the page can only ever text their own phone. Rate limits keep the
 * cost to a few cents a day. Replace this with your own auth when you build
 * on the template.
 *
 * POST { to, text, password } -> texts any US number. Only when
 * SEND_FORM_PASSWORD is set on the project; otherwise it's refused.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { to?: unknown; text?: unknown; password?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (body && "password" in body) return passwordMode(body, text);

  const sid = readSid(req);
  const session = sid ? await getSession(sid) : null;
  if (!session) {
    return refuse(401, "Text your number first. Then you can text that phone from here.");
  }
  const to = session.number;
  if (!US_E164.test(to)) return refuse(400, `This page can only text US numbers. Your phone is ${session.last4}.`);
  if (!text) return refuse(400, "Enter a message.");
  if (text.length > MAX_TEXT) return refuse(400, `Keep it to ${MAX_TEXT} characters.`);
  if (await isOptedOut(to)) return refuse(403, "This phone opted out. Text START to your number to opt back in.");

  const windowKey = `rl:n:${to}:${Math.floor(Date.now() / PER_NUMBER_WINDOW_MS)}`;
  const dayKey = `rl:day:${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const [inWindow, today] = await Promise.all([count(windowKey), count(dayKey)]);
  if (inWindow >= PER_NUMBER_SENDS) {
    return refuse(429, `That's ${PER_NUMBER_SENDS} texts in 10 minutes. Try again in a few minutes.`);
  }
  if (today >= dailySends()) return refuse(429, "This demo has sent its texts for today. Try again tomorrow.");

  return deliver(to, text, async () => {
    await Promise.all([bump(windowKey, PER_NUMBER_WINDOW_MS / 1000 + 60), bump(dayKey, DAY_S + 2 * 3600)]);
  });
}

async function passwordMode(body: { to?: unknown; password?: unknown }, text: string) {
  if (!process.env.SEND_FORM_PASSWORD) {
    return refuse(403, "Sending to any number is off. Set SEND_FORM_PASSWORD in your Vercel project settings and redeploy.");
  }
  if (!checkSendPassword(body.password)) return refuse(401, "The password is incorrect.");
  const to = typeof body.to === "string" ? body.to.replace(/[\s()-]/g, "") : "";
  if (!to || !text) return refuse(400, "Enter a phone number and a message.");
  if (!US_E164.test(to)) {
    return refuse(400, "Enter a US phone number in E.164 format, for example +14155550123. This integration only sends to US numbers.");
  }
  if (text.length > MAX_TEXT) return refuse(400, `Keep it to ${MAX_TEXT} characters.`);
  return deliver(to, text);
}

async function deliver(to: string, text: string, onSent?: () => Promise<void>) {
  try {
    const msg = await sendSms(to, text);
    const status = msg.to?.[0]?.status;
    if (msg.id) {
      // Awaited, so the page's next poll already shows the text.
      await Promise.all([
        setStatus(msg.id, classify({ status })),
        pushFeed([{ id: msg.id, dir: "out", last4: last4(to), nh: numberHash(to), text, at: Date.now() }]),
        onSent?.(),
      ]);
    }
    return Response.json({ id: msg.id, status });
  } catch (err) {
    if (err instanceof TelnyxError && classify({ syncError: err }).key === "optedout") {
      await setOptOut(to, true);
      return refuse(403, "This phone opted out. Text START to your number to opt back in.");
    }
    const status = err instanceof TelnyxError && err.status < 500 ? 400 : 502;
    return refuse(status, err instanceof Error ? err.message : String(err));
  }
}

const refuse = (status: number, error: string) => Response.json({ error }, { status });
