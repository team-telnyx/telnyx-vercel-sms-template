# Next.js routes for Telnyx SMS on Vercel

App Router route handlers, Node.js runtime (the default). Both versions read the `TELNYX_*` variables the integration adds. Pick one: plain `fetch` with no dependencies, or the `telnyx` npm package (v7 or later).

## Send: `app/api/send/route.ts`

### With fetch

```ts
// app/api/send/route.ts
const US_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

export async function POST(req: Request) {
  // Add your own auth check here first: every text is paid from the prepaid balance.
  const { to, text } = (await req.json()) as { to?: string; text?: string };
  if (!to || !US_E164.test(to) || !text) {
    return Response.json({ error: "Send { to: '+1XXXXXXXXXX', text }. US numbers only." }, { status: 400 });
  }
  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
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

const US_E164 = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

export async function POST(req: Request) {
  // Add your own auth check here first: every text is paid from the prepaid balance.
  const { to, text } = (await req.json()) as { to?: string; text?: string };
  if (!to || !US_E164.test(to) || !text) {
    return Response.json({ error: "Send { to: '+1XXXXXXXXXX', text }. US numbers only." }, { status: 400 });
  }
  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });
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
  const telnyx = new Telnyx({
    apiKey: process.env.TELNYX_API_KEY,
    publicKey: process.env.TELNYX_PUBLIC_KEY,
  });
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

## Event shapes you'll use

- `message.received`: `data.id` (event id, use it to dedupe), `data.payload.from.phone_number`, `data.payload.to[0].phone_number` (your number), `data.payload.text`.
- `message.sent`, `message.finalized`: `data.payload.id` (the message id from the send response), `data.payload.to[0].status` (`sent`, `delivered`, `sending_failed`, `delivery_failed`, `delivery_unconfirmed`) and `data.payload.errors` (code and title, for example 40010).

## Testing locally

Webhooks only reach the production domain. To receive on `localhost:3000`, expose it with a tunnel (for example `ngrok http 3000`) and set that URL as the resource's webhook URL in Vercel while testing. Change it back afterwards. Sending works locally once `vercel env pull .env.local` has run.
