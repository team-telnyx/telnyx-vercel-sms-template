import { checkSendPassword, sendSms, TelnyxError, US_E164 } from "@/lib/telnyx";

/**
 * POST { to: "+1...", text: "...", password: "..." } -> sends an SMS from your Telnyx number.
 *
 * Protected by SEND_FORM_PASSWORD: without it, anyone who finds your
 * deployment could send texts on your balance. Replace this with your own
 * auth (or delete the route) when you build on the template.
 */
export async function POST(req: Request) {
  if (!process.env.SEND_FORM_PASSWORD) {
    return Response.json(
      { error: "Sending is disabled: set SEND_FORM_PASSWORD in your Vercel project settings and redeploy." },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => null)) as { to?: unknown; text?: unknown; password?: unknown } | null;
  if (!checkSendPassword(body?.password)) {
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }
  const to = typeof body?.to === "string" ? body.to.replace(/[\s()-]/g, "") : "";
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!to || !text) return Response.json({ error: "to and text are required" }, { status: 400 });
  if (!US_E164.test(to)) {
    return Response.json(
      { error: "Use a US number in E.164 format, e.g. +14155550123. This integration sends to US destinations only." },
      { status: 400 },
    );
  }
  if (text.length > 1600) return Response.json({ error: "Keep the message under 1,600 characters." }, { status: 400 });
  try {
    const msg = await sendSms(to, text);
    return Response.json({ id: msg.id, status: msg.to?.[0]?.status });
  } catch (err) {
    const status = err instanceof TelnyxError && err.status < 500 ? 400 : 502;
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
