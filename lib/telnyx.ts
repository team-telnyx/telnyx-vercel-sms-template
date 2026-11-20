/**
 * Telnyx helpers for this template, built on the official `telnyx` SDK:
 * send an SMS, and verify the Ed25519 signature Telnyx puts on every webhook.
 *
 * No long-lived API key is stored in the project. The deployment's Vercel
 * OIDC token is exchanged at TELNYX_TOKEN_URL for a short-lived Telnyx token
 * (about an hour) that can only send and read messages.
 */
import crypto from "node:crypto";
import { getVercelOidcToken } from "@vercel/oidc";
import Telnyx, { APIError } from "telnyx";

/** US numbers in E.164: +1 then ten digits. Your messaging profile only allows US destinations. */
export const US_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

/** An error worth showing to the person sending: what Telnyx said, plus a hint when we know one. */
export class TelnyxError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly title?: string,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

/**
 * A client per call, so it always picks up the current environment variables.
 * No automatic retries: a retried send could deliver the same text twice, and
 * the inbound webhook has to answer Telnyx within 2 seconds.
 */
function telnyxClient(apiKey: string | null = null) {
  return new Telnyx({ apiKey, publicKey: process.env.TELNYX_PUBLIC_KEY?.trim() || null, maxRetries: 0 });
}

/** Renew the cached token this long before it expires. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000;

/** The Vercel OIDC token is exchanged for one addressed to Telnyx only. */
const AUDIENCE = "https://vercel.telnyx.com";

let cached: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

/** Tests only: forget the cached token. */
export function resetTelnyxTokenForTests() {
  cached = null;
  inFlight = null;
}

/**
 * The bearer token for Telnyx API calls.
 *
 * - TELNYX_API_KEY, if the project still has one (numbers added before the
 *   switch to OIDC).
 * - Otherwise a short-lived token from TELNYX_TOKEN_URL, in exchange for this
 *   deployment's Vercel OIDC token. It is cached in memory and renewed 5
 *   minutes before it expires; concurrent callers share one request.
 */
export async function getTelnyxToken(): Promise<string> {
  const key = process.env.TELNYX_API_KEY?.trim();
  if (key) return key;
  if (cached && cached.expiresAt - REFRESH_BEFORE_MS > Date.now()) return cached.token;
  inFlight ??= fetchTelnyxToken().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

type TokenReply = { token?: string; expiresAt?: string; error?: { code?: string; message?: string } };

async function fetchTelnyxToken(): Promise<string> {
  const url = process.env.TELNYX_TOKEN_URL?.trim();
  if (!url) {
    throw new TelnyxError(
      "TELNYX_TOKEN_URL isn't set. Connect your Telnyx phone number to this project in Vercel and redeploy.",
      500,
    );
  }
  let oidc: string;
  try {
    oidc = await getVercelOidcToken({ audience: AUDIENCE });
  } catch {
    throw new TelnyxError(
      "No Vercel OIDC token is available. Vercel provides one to every deployment; locally, run `vercel env pull .env.local` to get VERCEL_OIDC_TOKEN.",
      500,
    );
  }
  const phoneNumber = process.env.TELNYX_PHONE_NUMBER?.trim();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${oidc}`, "Content-Type": "application/json" },
    body: JSON.stringify(phoneNumber ? { phoneNumber } : {}),
  });
  const body = (await res.json().catch(() => null)) as TokenReply | null;
  if (!res.ok) {
    const code = body?.error?.code;
    const message = body?.error?.message ?? `HTTP ${res.status}`;
    throw new TelnyxError(`Telnyx token ${res.status}${code ? ` (${code})` : ""}: ${message}`, res.status, code);
  }
  const expiresAt = body?.expiresAt ? Date.parse(body.expiresAt) : Number.NaN;
  if (!body?.token || !Number.isFinite(expiresAt)) {
    throw new TelnyxError("Telnyx token: the response had no token", 502);
  }
  cached = { token: body.token, expiresAt };
  return body.token;
}

/**
 * Run a Telnyx call with the current token. A short-lived token can be
 * revoked early (a rotation in Vercel): on a 401, drop it, exchange again
 * once and retry once. A 401 means Telnyx refused the request, so nothing
 * was sent twice. A TELNYX_API_KEY is never retried.
 */
async function withTelnyxToken<T>(call: (token: string) => Promise<T>): Promise<T> {
  const token = await getTelnyxToken();
  try {
    return await call(token);
  } catch (err) {
    const usesKey = Boolean(process.env.TELNYX_API_KEY?.trim());
    if (usesKey || !(err instanceof APIError) || err.status !== 401) throw err;
    if (cached?.token === token) cached = null;
    return call(await getTelnyxToken());
  }
}

export async function sendSms(to: string, text: string) {
  const from = process.env.TELNYX_PHONE_NUMBER;
  if (!from) {
    throw new TelnyxError(
      "TELNYX_PHONE_NUMBER isn't set. Connect your Telnyx phone number to this project in Vercel and redeploy.",
      500,
    );
  }
  try {
    const res = await withTelnyxToken((key) => telnyxClient(key).messages.send({
      from,
      to,
      text,
      // No messaging_profile_id: Telnyx picks the profile from `from`.
    }));
    if (!res.data) throw new TelnyxError("Telnyx 200: the response had no message data", 502);
    return res.data;
  } catch (err) {
    throw toTelnyxError(err);
  }
}

/**
 * Look up a message's current status (`GET /v2/messages/{id}`). The page uses
 * it when a delivery receipt is late.
 */
export async function getMessageStatus(id: string) {
  try {
    const res = await withTelnyxToken((key) => telnyxClient(key).messages.retrieve(id));
    const data = res.data as
      | { to?: { status?: string }[]; errors?: { code?: string; title?: string; detail?: string }[] }
      | undefined;
    return { status: data?.to?.[0]?.status, errors: data?.errors };
  } catch (err) {
    throw toTelnyxError(err);
  }
}

function toTelnyxError(err: unknown): unknown {
  if (err instanceof APIError && err.status) {
    // The SDK keeps the response body on err.error: { errors: [{ code, title, detail }] }.
    const body = err.error as { errors?: { code?: string; title?: string; detail?: string }[] } | undefined;
    const e = body?.errors?.[0];
    const what = e?.detail || e?.title || `HTTP ${err.status}`;
    return new TelnyxError(
      `Telnyx ${err.status}${e?.code ? ` (code ${e.code})` : ""}: ${what}`,
      err.status,
      e?.code,
      e?.title,
      e?.detail,
    );
  }
  return err;
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
