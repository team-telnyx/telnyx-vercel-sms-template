# Next.js routes for Telnyx SMS on Vercel

App Router route handlers, Node.js runtime (the default). Both versions read the `TELNYX_*` variables the integration adds. Pick one: plain `fetch`, or the `telnyx` npm package (v7 or later).

## Get a Telnyx token: `lib/telnyx-token.ts`

No Telnyx API key is stored in the project. Exchange the deployment's Vercel OIDC token at `TELNYX_TOKEN_URL` for a short-lived Telnyx token (about an hour), and reuse it until 5 minutes before it expires. `npm install @vercel/oidc`

```ts
// lib/telnyx-token.ts
import { getVercelOidcToken } from "@vercel/oidc";

// A Vercel OIDC token addressed to Telnyx only.
const AUDIENCE = "https://vercel.telnyx.com";

let cached: { token: string; expiresAt: number } | null = null;

export async function getTelnyxToken(): Promise<string> {
  // Numbers added before the switch to OIDC may still have a key.
  if (process.env.TELNYX_API_KEY) return process.env.TELNYX_API_KEY;
  if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;

  const res = await fetch(process.env.TELNYX_TOKEN_URL!, {
    method: "POST",
    headers: {
      // Only ever sent to TELNYX_TOKEN_URL, never to the Telnyx API.
      Authorization: `Bearer ${await getVercelOidcToken({ audience: AUDIENCE })}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phoneNumber: process.env.TELNYX_PHONE_NUMBER }),
  });
  const json = await res.json();
  // 403 not_connected: connect the number to this project for this environment.
  if (!res.ok) throw new Error(`Telnyx token ${res.status}: ${json.error?.message}`);
  cached = { token: json.token, expiresAt: Date.parse(json.expiresAt) };
  return json.token;
}
```

If the Telnyx API answers 401, the token was revoked early (a rotation in Vercel): set `cached = null`, get a new token and retry once. The template's `lib/telnyx.ts` does this.

## Send: `app/api/send/route.ts`

### With fetch

```ts
// app/api/send/route.ts
import crypto from "node:crypto";
import { getTelnyxToken } from "@/lib/telnyx-token";

const US_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

// Every text is paid from the prepaid balance, so nothing is sent without auth.
// This placeholder wants `Authorization: Bearer <SEND_API_SECRET>` and refuses
// everything while SEND_API_SECRET is unset. Swap in your app's own auth.
function authorized(req: Request) {
  const secret = process.env.SEND_API_SECRET;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return !!secret && given.length === want.length && crypto.timingSafeEqual(given, want);
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const { to, text } = (await req.json()) as { to?: string; text?: string };
  if (!to || !US_E164.test(to) || !text) {
    return Response.json({ error: "Send { to: '+1XXXXXXXXXX', text }. US numbers only." }, { status: 400 });
  }
  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getTelnyxToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: process.env.TELNYX_PHONE_NUMBER, to, text }),
  });
  const json = await res.json();
  if (!res.ok) {
    // json.errors[0] has code, title and detail, for example code "40309".
    return Response.json({ error: json.errors?.[0] ?? json }, { status: res.status });
  }
  return Response.json({ id: json.data.id, status: json.data.to?.[0]?.status });
}
```

### With the telnyx package

`npm install telnyx`

```ts
// app/api/send/route.ts
import Telnyx from "telnyx";
import crypto from "node:crypto";
import { getTelnyxToken } from "@/lib/telnyx-token";

const US_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

// Every text is paid from the prepaid balance, so nothing is sent without auth.
// This placeholder wants `Authorization: Bearer <SEND_API_SECRET>` and refuses
// everything while SEND_API_SECRET is unset. Swap in your app's own auth.
function authorized(req: Request) {
  const secret = process.env.SEND_API_SECRET;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return !!secret && given.length === want.length && crypto.timingSafeEqual(given, want);
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  const { to, text } = (await req.json()) as { to?: string; text?: string };
  if (!to || !US_E164.test(to) || !text) {
    return Response.json({ error: "Send { to: '+1XXXXXXXXXX', text }. US numbers only." }, { status: 400 });
  }
  // maxRetries: 0, because the SDK retries timeouts and 5xx by default, and a retried send can deliver the text twice.
  const telnyx = new Telnyx({ apiKey: await getTelnyxToken(), maxRetries: 0 });
  try {
    const { data } = await telnyx.messages.send({ from: process.env.TELNYX_PHONE_NUMBER, to, text });
    return Response.json({ id: data?.id, status: data?.to?.[0]?.status });
  } catch (err) {
    if (err instanceof Telnyx.APIError) {
      return Response.json({ error: err.message }, { status: err.status ?? 502 });
    }
    throw err;
  }
}
```

## Receive: `app/api/telnyx/inbound/route.ts`

The path matters: the integration points the webhook at `/api/telnyx/inbound` on the connected project's production domain.

### With node:crypto

```ts
// app/api/telnyx/inbound/route.ts
import crypto from "node:crypto";

// DER header for a raw 32-byte Ed25519 public key
const SPKI = Buffer.from("302a300506032b6570032100", "hex");

function verify(raw: string, sig: string | null, ts: string | null) {
  const key = process.env.TELNYX_PUBLIC_KEY;
  if (!key || !sig || !ts) return false;
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  try {
    const pub = crypto.createPublicKey({
      key: Buffer.concat([SPKI, Buffer.from(key, "base64")]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(`${ts}|${raw}`), pub, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const raw = await req.text(); // raw body: verify before parsing
  const ok = verify(raw, req.headers.get("telnyx-signature-ed25519"), req.headers.get("telnyx-timestamp"));
  if (!ok) return new Response("invalid signature", { status: 401 });

  const { data } = JSON.parse(raw);
  // Dedupe on data.id here (Redis, a database): retries can repeat an event.
  if (data.event_type === "message.received") {
    console.log("text from", data.payload.from.phone_number, data.payload.text);
    // Any reply must be awaited before returning, and must be done within 2 seconds.
  } else if (data.event_type === "message.finalized") {
    console.log("delivery", data.payload.id, data.payload.to?.[0]?.status, data.payload.errors);
  }
  return Response.json({ ok: true });
}
```

### With the telnyx package

```ts
// app/api/telnyx/inbound/route.ts
import Telnyx from "telnyx";

export async function POST(req: Request) {
  const raw = await req.text(); // raw body: verify before parsing
  // Verifying a webhook needs only the public key, no token.
  const telnyx = new Telnyx({ apiKey: null, publicKey: process.env.TELNYX_PUBLIC_KEY });
  try {
    // Checks telnyx-signature-ed25519 over `${telnyx-timestamp}|${raw}`, 5-minute tolerance.
    await telnyx.webhooks.unwrap(raw, { headers: Object.fromEntries(req.headers) });
  } catch {
    return new Response("invalid signature", { status: 401 });
  }

  const { data } = JSON.parse(raw);
  if (data.event_type === "message.received") {
    console.log("text from", data.payload.from.phone_number, data.payload.text);
  }
  return Response.json({ ok: true });
}
```

## A live feed and paired sending (the template's pattern)

The template keeps a short-lived feed in Vercel Runtime Cache, so the home page can show texts as they arrive without a database. The same shape works with any store.

```ts
// lib/store.ts (excerpt)
import crypto from "node:crypto";
import { getCache } from "@vercel/functions";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 40);
// Digits-only namespace (it isn't hashed) and SHA-256 keys (no numbers, no collisions).
const key = (k: string) => `tsms${(process.env.TELNYX_PHONE_NUMBER ?? "").replace(/\D/g, "")}$${sha(k)}`;
const cache = () => getCache({ keyHashFunction: (k) => k });

export async function pushFeed(item: { id: string; text: string; at: number }) {
  const prev = ((await cache().get(key("feed"))) as { items: unknown[] } | null) ?? { items: [] };
  // `name` is what Observability shows: never the raw key, which may contain a number.
  await cache().set(key("feed"), { ver: Date.now(), items: [item, ...prev.items].slice(0, 20) }, { ttl: 86_400, name: "feed" });
}
```

In the inbound route, await only the reply and do the rest after the response:

```ts
import { after } from "next/server";

const auto = data.payload.autoresponse_type; // "STOP" | "START" | "HELP" when Telnyx handled a keyword
if (auto) {
  // Telnyx already replied and blocked or unblocked the sender. Send nothing.
} else if (/^\s*PING\b/i.test(data.payload.text ?? "")) {
  await sendSms(from, "PONG"); // awaited: the reply must not be lost
}
after(() => pushFeed({ id: data.id, text: data.payload.text, at: Date.now() }));
```

Paired sending, with no password: the page asks the server for a one-time code (with `POST`, so link previews don't create codes) and shows "Text PING 4F7K". When the webhook sees a live code, it stores `session -> sender number` and deletes the code. The send route then texts `session.number` and ignores any `to` in the request, so a visitor can only text their own phone. Add per-phone and daily limits.

For unit tests, mock `after()`, which throws outside a Next.js request:

```ts
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void Promise.resolve().then(fn) }));
```

## Event shapes you'll use

- `message.received`: `data.id` (event id, use it to dedupe), `data.payload.from.phone_number`, `data.payload.to[0].phone_number` (your number), `data.payload.text`, and `data.payload.autoresponse_type` when Telnyx handled STOP, START or HELP.
- `message.sent`, `message.finalized`: `data.payload.id` (the message id from the send response), `data.payload.to[0].status` (`sent`, `delivered`, `sending_failed`, `delivery_failed`, `delivery_unconfirmed`) and `data.payload.errors` (code and title, for example 40010).

## Testing locally

Webhooks only reach the production domain. To receive on `localhost:3000`, expose it with a tunnel (for example `ngrok http 3000`) and set that URL as the resource's webhook URL in Vercel while testing. Change it back afterwards. Sending works locally once `vercel env pull .env.local` has run.
