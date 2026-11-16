/** A fake Telnyx: signed webhooks and canned API replies. No test talks to Telnyx. */
import crypto from "node:crypto";
import { vi } from "vitest";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
export const PUBLIC_KEY_B64 = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

export function signedHeaders(body: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64");
  return { "content-type": "application/json", "telnyx-signature-ed25519": sig, "telnyx-timestamp": String(ts) };
}

export function telnyxReply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export const queued = (id = "msg-1", to = "+14155550123") => ({ data: { id, to: [{ phone_number: to, status: "queued" }] } });

export function stubTelnyxEnv() {
  vi.stubEnv("TELNYX_API_KEY", "KEY_TEST");
  vi.stubEnv("TELNYX_PHONE_NUMBER", "+13125550100");
  vi.stubEnv("TELNYX_MESSAGING_PROFILE_ID", "profile-1");
  vi.stubEnv("TELNYX_PUBLIC_KEY", PUBLIC_KEY_B64);
  vi.stubEnv("SEND_FORM_PASSWORD", "");
  vi.stubEnv("VERCEL_ENV", "");
}

let n = 0;
export function received(text: string, opts: { from?: string; id?: string; autoresponse_type?: string } = {}) {
  return JSON.stringify({
    data: {
      id: opts.id ?? `evt-${++n}-${Date.now()}`,
      event_type: "message.received",
      payload: {
        from: { phone_number: opts.from ?? "+14155550123" },
        text,
        ...(opts.autoresponse_type ? { autoresponse_type: opts.autoresponse_type } : {}),
      },
    },
  });
}

export function receipt(
  eventType: "message.sent" | "message.finalized",
  messageId: string,
  status: string,
  errors?: { code?: string; title?: string; detail?: string }[],
) {
  return JSON.stringify({
    data: { id: `evt-r-${++n}`, event_type: eventType, payload: { id: messageId, to: [{ status }], ...(errors ? { errors } : {}) } },
  });
}

export const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
