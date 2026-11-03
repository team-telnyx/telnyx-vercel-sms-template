import { checkSendPassword, dial, TelnyxError, US_E164 } from "@/lib/telnyx";

/**
 * POST { to: "+1...", password: "..." } -> calls that number from your Telnyx
 * number. When it's answered, /api/telnyx/voice speaks a short message and
 * hangs up.
 *
 * Protected by SEND_FORM_PASSWORD, like /api/send: without it, anyone who
 * finds your deployment could place calls on your balance. Replace this with
 * your own auth (or delete the route) when you build on the template.
 */
export async function POST(req: Request) {
  if (!process.env.TELNYX_CONNECTION_ID) {
    return Response.json(
      { error: "Calling isn't set up for this project. Redeploy after Vercel adds TELNYX_CONNECTION_ID." },
      { status: 403 },
    );
  }
  if (!process.env.SEND_FORM_PASSWORD) {
    return Response.json(
      { error: "Calling is off. Set SEND_FORM_PASSWORD in your Vercel project settings and redeploy." },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => null)) as { to?: unknown; password?: unknown } | null;
  if (!checkSendPassword(body?.password)) {
    return Response.json({ error: "The password is incorrect." }, { status: 401 });
  }
  const to = typeof body?.to === "string" ? body.to.replace(/[\s()-]/g, "") : "";
  if (!to) return Response.json({ error: "Enter a phone number." }, { status: 400 });
  if (!US_E164.test(to)) {
    return Response.json(
      { error: "Enter a US phone number in E.164 format, for example +14155550123. This integration only calls US numbers." },
      { status: 400 },
    );
  }
  try {
    const call = await dial(to, { step: "outbound" });
    return Response.json({ call_control_id: call?.call_control_id });
  } catch (err) {
    const status = err instanceof TelnyxError && err.status < 500 ? 400 : 502;
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
