/**
 * Telnyx helpers for this template, built on the official `telnyx` SDK:
 * send an SMS, and verify the Ed25519 signature Telnyx puts on every webhook.
 */
import crypto from "node:crypto";
import Telnyx, { APIError } from "telnyx";

/** US numbers in E.164: +1 then ten digits. Your messaging profile only allows US destinations. */
export const US_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

/** An error worth showing to the person sending: what Telnyx said, plus a hint when we know one. */
export class TelnyxError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * A client per call, so it always picks up the current environment variables.
 * No automatic retries: a retried send could deliver the same text twice, and
 * the inbound webhook has to answer Telnyx within 2 seconds.
 */
function telnyxClient(apiKey: string | null = process.env.TELNYX_API_KEY ?? null) {
  return new Telnyx({ apiKey, publicKey: process.env.TELNYX_PUBLIC_KEY?.trim() || null, maxRetries: 0 });
}

export async function sendSms(to: string, text: string) {
  const key = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_PHONE_NUMBER;
  if (!key || !from) {
    throw new TelnyxError(
      "TELNYX_API_KEY or TELNYX_PHONE_NUMBER isn't set. Connect your Telnyx phone number to this project in Vercel and redeploy.",
      500,
    );
  }
  try {
    const res = await telnyxClient(key).messages.send({
      from,
      to,
      text,
      messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
    });
    if (!res.data) throw new TelnyxError("Telnyx 200: the response had no message data", 502);
    return res.data;
  } catch (err) {
    if (err instanceof APIError && err.status) {
      // The SDK keeps the response body on err.error: { errors: [{ code, title, detail }] }.
      const body = err.error as { errors?: { code?: string; title?: string; detail?: string }[] } | undefined;
      const e = body?.errors?.[0];
      const what = e?.detail || e?.title || `HTTP ${err.status}`;
      throw new TelnyxError(`Telnyx ${err.status}${e?.code ? ` (code ${e.code})` : ""}: ${what}`, err.status, e?.code);
    }
    throw err;
  }
}

/**
 * Verify `telnyx-signature-ed25519` over `${telnyx-timestamp}|${rawBody}` with
 * the SDK's `webhooks.unwrap`. Fails closed: no configured public key, no
 * headers, a stale timestamp (> 5 minutes) or a bad signature all return null.
 * On success, returns the parsed event. A correctly signed body that isn't JSON
 * throws a SyntaxError.
 */
export async function verifyTelnyxWebhook<T = unknown>(rawBody: string, headers: Headers): Promise<T | null> {
  if (!process.env.TELNYX_PUBLIC_KEY?.trim()) return null;
  try {
    const event = await telnyxClient().webhooks.unwrap(rawBody, { headers: Object.fromEntries(headers) });
    return event as T;
  } catch (err) {
    // unwrap checks the signature first and only then parses the body.
    if (err instanceof SyntaxError) throw err;
    return null;
  }
}

/**
 * Constant-time check of the password that protects the send form.
 * Fails closed when SEND_FORM_PASSWORD is not set, so a fresh deployment is
 * never an open relay that anyone can use to spend your prepaid balance.
 */
export function checkSendPassword(given: unknown, expected = process.env.SEND_FORM_PASSWORD): boolean {
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  // Only the length can leak here, never the content.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
