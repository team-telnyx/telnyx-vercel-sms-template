/**
 * Minimal Telnyx helpers for this template: send an SMS, and verify the
 * Ed25519 signature Telnyx puts on every webhook. No SDK needed.
 */
import crypto from "node:crypto";

const API = "https://api.telnyx.com/v2";

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

export async function sendSms(to: string, text: string) {
  const key = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_PHONE_NUMBER;
  if (!key || !from) {
    throw new TelnyxError(
      "TELNYX_API_KEY or TELNYX_PHONE_NUMBER is not set. Connect your Telnyx number to this project in Vercel and redeploy.",
      500,
    );
  }
  const res = await fetch(`${API}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      text,
      messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { id: string; to: { status: string }[] };
    errors?: { code?: string; title?: string; detail?: string }[];
  };
  if (!res.ok || !json.data) {
    const e = json.errors?.[0];
    const what = e?.detail || e?.title || `HTTP ${res.status}`;
    throw new TelnyxError(`Telnyx ${res.status}${e?.code ? ` (code ${e.code})` : ""}: ${what}`, res.status, e?.code);
  }
  return json.data;
}

// SubjectPublicKeyInfo header for a raw Ed25519 key (RFC 8410).
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verify `telnyx-signature-ed25519` over `${telnyx-timestamp}|${rawBody}`.
 * Fails closed: no configured public key, no headers, a stale timestamp
 * (> 5 minutes) or a bad signature all return false.
 */
export function verifyTelnyxSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKeyB64 = process.env.TELNYX_PUBLIC_KEY,
): boolean {
  if (!publicKeyB64 || !signature || !timestamp) return false;
  if (!/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const raw = Buffer.from(publicKeyB64, "base64");
    const sig = Buffer.from(signature, "base64");
    if (raw.length !== 32 || sig.length !== 64) return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, sig);
  } catch {
    return false;
  }
}

/**
 * Constant-time check of the password that protects the send form.
 * Fails closed when SEND_FORM_PASSWORD is not set, so a fresh deployment is
 * never an open relay that anyone can use to spend your prepaid balance.
 */
export function checkSendPassword(given: unknown, expected = process.env.SEND_FORM_PASSWORD): boolean {
  if (!expected || typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
