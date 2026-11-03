import { callAction, decodeState, encodeState, verifyTelnyxSignature } from "@/lib/telnyx";

/**
 * Call Control webhooks from Telnyx: one POST per call event.
 *
 * The integration points your number's Call Control app here
 * (TELNYX_VOICE_WEBHOOK_URL holds the URL).
 *
 * The call flow:
 *  - Someone calls your number: answer, then read a menu and wait for a key.
 *    Press 1 to hear a message, then the call hangs up. Press 2 (or nothing)
 *    and it hangs up.
 *  - A call placed from the "Call me" form: speak a short message, then hang up.
 *
 * Rules that matter:
 *  - Verify the signature first and fail closed (401). Never trust the body.
 *  - Each event is a separate function invocation, so nothing is kept in
 *    memory between them. Where the call is in the flow travels with the call
 *    in client_state: Telnyx sends back whatever the last command set.
 *  - Await every command before returning. Vercel stops the function once the
 *    response is sent, so a command that isn't awaited never reaches Telnyx.
 *  - Retries can deliver the same event twice: dedupe on data.id. The set
 *    below is per function instance, so it is best effort.
 */
export const maxDuration = 30;

const seen = new Map<string, number>();
function alreadySeen(id: string): boolean {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 10 * 60_000) seen.delete(k);
  if (seen.has(id)) return true;
  seen.set(id, now);
  return false;
}

const MENU = "Hello from your Vercel app on Telnyx. Press 1 to hear a message, or 2 to hang up.";
const MESSAGE = "This call was answered by a Vercel Function. Goodbye.";
const OUTBOUND = "Hello from your Vercel app on Telnyx. This call was placed by a Vercel Function. Goodbye.";
const VOICE = { voice: "female", language: "en-US" };

type CallEvent = {
  data?: {
    id?: string;
    event_type?: string;
    payload?: {
      call_control_id?: string;
      direction?: string;
      client_state?: string;
      digits?: string;
      from?: string;
      to?: string;
    };
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

  if (!process.env.TELNYX_CONNECTION_ID) {
    // SMS-only install: no Call Control app is connected to this project.
    console.log("voice not configured: TELNYX_CONNECTION_ID isn't set. Redeploy after Vercel adds it.");
    return Response.json({ ok: true, ignored: true });
  }

  let event: CallEvent;
  try {
    event = JSON.parse(raw) as CallEvent;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const id = event.data?.id;
  const eventType = event.data?.event_type;
  const p = event.data?.payload ?? {};
  const callId = p.call_control_id;
  if (!id || !eventType || !callId) return Response.json({ ok: true, ignored: true });
  if (alreadySeen(id)) return Response.json({ ok: true, duplicate: true });

  const step = decodeState(p.client_state)?.step;
  console.log("call event", eventType, step ?? "-", p.direction ?? "", p.digits ?? "");

  try {
    await handle(eventType, callId, step, p);
  } catch (e) {
    // The caller may have hung up already; Telnyx then refuses the command.
    // Log it and still answer 200 so Telnyx doesn't retry.
    console.error("call command failed", eventType, e instanceof Error ? e.message : e);
  }
  return Response.json({ ok: true });
}

async function handle(
  eventType: string,
  callId: string,
  step: string | undefined,
  p: NonNullable<NonNullable<CallEvent["data"]>["payload"]>,
) {
  switch (eventType) {
    case "call.initiated":
      // Outgoing calls (from the "Call me" form) also send call.initiated; only answer incoming ones.
      if (p.direction === "incoming") {
        await callAction(callId, "answer", { client_state: encodeState({ step: "greet" }) });
      }
      return;

    case "call.answered":
      if (step === "greet") {
        await callAction(callId, "gather_using_speak", {
          payload: MENU,
          ...VOICE,
          valid_digits: "12",
          minimum_digits: 1,
          maximum_digits: 1,
          timeout_millis: 10_000,
          client_state: encodeState({ step: "menu" }),
        });
      } else if (step === "outbound") {
        await callAction(callId, "speak", { payload: OUTBOUND, ...VOICE, client_state: encodeState({ step: "bye" }) });
      }
      return;

    case "call.gather.ended":
      if (step !== "menu") return;
      if (p.digits === "1") {
        await callAction(callId, "speak", { payload: MESSAGE, ...VOICE, client_state: encodeState({ step: "bye" }) });
      } else {
        await callAction(callId, "hangup", {});
      }
      return;

    case "call.speak.ended":
      if (step === "bye") await callAction(callId, "hangup", {});
      return;

    default:
      // call.hangup, call.speak.started and the rest: nothing to do.
      return;
  }
}
