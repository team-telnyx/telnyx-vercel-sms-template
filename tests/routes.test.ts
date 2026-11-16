import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as inbound } from "@/app/api/telnyx/inbound/route";
import { POST as send } from "@/app/api/send/route";
import { GET as sessionGet, POST as sessionPost } from "@/app/api/session/route";
import { GET as feedGet, type FeedResponse } from "@/app/api/feed/route";
import * as store from "@/lib/store";
import { flushAfter, memoryCache } from "./helpers";
import { cookieFrom, queued, receipt, received, signedHeaders, stubTelnyxEnv, telnyxReply } from "./fixtures";

vi.mock("next/server", () => import("./helpers"));

const fetchMock = vi.fn();
let mem: ReturnType<typeof memoryCache>;

beforeEach(() => {
  mem = memoryCache();
  store.setCacheForTests(mem.cache);
  vi.stubGlobal("fetch", fetchMock);
  stubTelnyxEnv();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const hook = async (body: string) => {
  const res = await inbound(new Request("https://app.test/api/telnyx/inbound", { method: "POST", body, headers: signedHeaders(body) }));
  await flushAfter();
  return res;
};
const newSession = async (ua = "") => {
  const res = await sessionPost(new Request("https://app.test/api/session", { method: "POST", headers: { "user-agent": ua } }));
  return { res, cookie: cookieFrom(res), json: (await res.json()) as { code: string | null; smsHref: string; qrSvg: string; qrAlt: string; paired: unknown } };
};
const sendAs = (cookie: string | null, body: unknown) =>
  send(
    new Request("https://app.test/api/send", {
      method: "POST",
      body: JSON.stringify(body),
      headers: cookie ? { cookie } : {},
    }),
  );
const feed = async (cookie?: string, since?: number) =>
  (await (
    await feedGet(new Request(`https://app.test/api/feed${since ? `?since=${since}` : ""}`, { headers: cookie ? { cookie } : {} }))
  ).json()) as Extract<FeedResponse, { ver: number | null }>;
/** Pair a browser with +14155550123 (or `from`) by texting its code. */
async function paired(from = "+14155550123") {
  const s = await newSession();
  fetchMock.mockResolvedValueOnce(telnyxReply(200, queued("pong-1", from)));
  await hook(received(`PING ${s.json.code}`, { from }));
  fetchMock.mockReset();
  return s.cookie;
}
const sentBody = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body);

describe("POST /api/session", () => {
  it("sets an httpOnly, SameSite=Lax, Secure cookie and returns a code, link and QR code", async () => {
    const { res, json } = await newSession("iPhone");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^tsms_sid=[A-Za-z0-9_-]{22}; Path=\/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(json.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(json.smsHref).toBe(`sms:+13125550100&body=PING%20${json.code}`);
    expect(json.qrSvg.startsWith("<svg")).toBe(true);
    expect(json.qrAlt).toContain(`PING ${json.code} to +1 (312) 555-0100`);
  });

  it("returns the same code to the same browser without writing a new one", async () => {
    const first = await newSession();
    const writes = mem.calls.filter((c) => c.op === "set").length;
    const again = await sessionPost(new Request("https://app.test/api/session", { method: "POST", headers: { cookie: first.cookie } }));
    expect(again.headers.get("set-cookie")).toBeNull();
    expect(((await again.json()) as { code: string }).code).toBe(first.json.code);
    expect(mem.calls.filter((c) => c.op === "set").length).toBe(writes);
  });

  it("answers GET with 405, so link previews never create codes", async () => {
    expect(sessionGet().status).toBe(405);
  });
});

describe("pairing through the inbound webhook", () => {
  it("PING + code: replies PONG before responding, then links the browser", async () => {
    const s = await newSession();
    let replied = false;
    fetchMock.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 10));
      replied = true;
      return telnyxReply(200, queued("pong-1"));
    });
    const body = received(`ping ${s.json.code?.toLowerCase()}`);
    const res = await inbound(new Request("https://app.test/api/telnyx/inbound", { method: "POST", body, headers: signedHeaders(body) }));
    expect(replied).toBe(true);
    expect(res.status).toBe(200);
    expect(sentBody()).toMatchObject({ to: "+14155550123", text: "PONG from your Vercel project" });
    await flushAfter();
    const f = await feed(s.cookie);
    expect(f.paired).toEqual({ last4: "•••0123" });
    expect(f.items?.map((i) => [i.dir, i.kind, i.mine])).toEqual([
      ["out", "pong", true],
      ["in", undefined, true],
    ]);
  });

  it("PING from a non-US phone: pairs, sends no PONG, and says why", async () => {
    const s = await newSession();
    await hook(received(`PING ${s.json.code}`, { from: "+353857688030" }));
    expect(fetchMock).not.toHaveBeenCalled();
    await flushAfter();
    const f = await feed(s.cookie);
    expect(f.paired).toEqual({ last4: "•••8030" });
    expect(f.items?.map((i) => [i.dir, i.kind])).toEqual([
      ["in", "nonus"],
      ["in", undefined],
    ]);
  });

  it("a code without PING pairs without a reply", async () => {
    const s = await newSession();
    await hook(received(s.json.code!));
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await feed(s.cookie)).paired).toEqual({ last4: "•••0123" });
  });

  it("a code works once: a second phone can't re-point the browser", async () => {
    const s = await newSession();
    await hook(received(s.json.code!, { from: "+14155550123" }));
    await hook(received(s.json.code!, { from: "+16465550199" }));
    expect((await feed(s.cookie)).paired).toEqual({ last4: "•••0123" });
  });

  it("shows message text only to the paired browser; others see masked metadata", async () => {
    const cookie = await paired();
    await hook(received("my secret", { from: "+14155550123" }));
    const own = await feed(cookie);
    const stranger = await feed();
    expect(own.items?.[0]).toMatchObject({ text: "my secret", mine: true, last4: "•••0123" });
    expect(stranger.items?.[0]).toMatchObject({ mine: false, last4: "•••0123", dir: "in" });
    expect(stranger.items?.[0]).not.toHaveProperty("text");
    expect(JSON.stringify(stranger)).not.toContain("4155550123");
  });
});

describe("STOP, START and HELP", () => {
  it("STOP: no reply at all, the phone is marked opted out and shows in the feed", async () => {
    await hook(received("STOP"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.isOptedOut("+14155550123")).toBe(true);
    expect((await feed()).items?.[0]).toMatchObject({ kind: "stop", last4: "•••0123" });
  });

  it("START clears the opt-out, also when only autoresponse_type says so", async () => {
    await hook(received("STOP"));
    await hook(received("Commencer", { autoresponse_type: "START" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await store.isOptedOut("+14155550123")).toBe(false);
  });

  it("HELP: no reply from the app", async () => {
    await hook(received("HELP"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await feed()).items?.[0].kind).toBe("help");
  });
});

describe("inbound duplicates and receipts", () => {
  it("skips a duplicate event even on a fresh instance (cache-backed dedupe)", async () => {
    const body = received("PING", { id: "evt-dup" });
    fetchMock.mockResolvedValue(telnyxReply(200, queued("pong-x")));
    await hook(body);
    // A new function instance: fresh modules (an empty Map), the same shared cache.
    vi.resetModules();
    (await import("@/lib/store")).setCacheForTests(mem.cache);
    const fresh = (await import("@/app/api/telnyx/inbound/route")).POST;
    const res = await fresh(new Request("https://app.test/api/telnyx/inbound", { method: "POST", body, headers: signedHeaders(body) }));
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records receipts forward-only: 'sent' after 'finalized' stays delivered", async () => {
    await hook(receipt("message.finalized", "m1", "delivered"));
    await hook(receipt("message.sent", "m1", "sent"));
    expect((await store.getStatus("m1"))?.key).toBe("delivered");
  });

  it("maps a not-registered delivery failure for the timeline", async () => {
    await hook(receipt("message.finalized", "m2", "delivery_failed", [{ code: "40010", title: "Not 10DLC registered" }]));
    expect(await store.getStatus("m2")).toMatchObject({ key: "unregistered", stage: 3, code: "40010" });
  });

  it("still answers 200 and sends PONG when the cache is down", async () => {
    store.setCacheForTests(memoryCache({ failing: true }).cache);
    fetchMock.mockResolvedValueOnce(telnyxReply(200, queued("pong-1")));
    const res = await hook(received("PING"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/send (paired mode)", () => {
  it("refuses a browser that hasn't paired", async () => {
    const res = await sendAs(null, { text: "hi" });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends to the paired phone and ignores any `to` in the body", async () => {
    const cookie = await paired();
    fetchMock.mockResolvedValueOnce(telnyxReply(200, queued("m-out")));
    const res = await sendAs(cookie, { text: " Hello ", to: "+19995550000" });
    expect(await res.json()).toEqual({ id: "m-out", status: "queued" });
    expect(sentBody()).toMatchObject({ to: "+14155550123", text: "Hello" });
    const f = await feed(cookie);
    expect(f.items?.[0]).toMatchObject({ id: "m-out", dir: "out", text: "Hello", status: { key: "accepted" } });
  });

  it("reports a receipt that arrives after the page last polled", async () => {
    const cookie = await paired();
    fetchMock.mockResolvedValueOnce(telnyxReply(200, queued("m-out")));
    await sendAs(cookie, { text: "Hello" });
    const before = await feed(cookie);
    await new Promise((r) => setTimeout(r, 5));
    await hook(receipt("message.sent", "m-out", "sent"));
    await hook(receipt("message.finalized", "m-out", "delivery_failed", [{ code: "40010" }]));
    // The feed itself didn't change, but the receipt did: the page must not get "unchanged".
    const f = await feed(cookie, before.ver!);
    expect(f.items?.[0].status).toMatchObject({ key: "unregistered", stage: 3 });
  });

  it("refuses a paired phone outside the US", async () => {
    const cookie = await paired("+447700900123");
    const res = await sendAs(cookie, { text: "hi" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("This page can only text US numbers. Your phone is •••0123.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an opted-out phone without calling Telnyx", async () => {
    const cookie = await paired();
    await hook(received("STOP"));
    const res = await sendAs(cookie, { text: "hi" });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows 3 texts per phone per 10 minutes", async () => {
    const cookie = await paired();
    fetchMock.mockImplementation(async () => telnyxReply(200, queued(`m-${Math.random()}`)));
    for (let i = 0; i < 3; i++) expect((await sendAs(cookie, { text: `t${i}` })).status).toBe(200);
    const res = await sendAs(cookie, { text: "t4" });
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops at the daily cap", async () => {
    vi.stubEnv("DAILY_SEND_LIMIT", "1");
    const cookie = await paired();
    fetchMock.mockImplementation(async () => telnyxReply(200, queued(`m-${Math.random()}`)));
    expect((await sendAs(cookie, { text: "one" })).status).toBe(200);
    const res = await sendAs(cookie, { text: "two" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("This demo has sent its texts for today. Try again tomorrow.");
  });

  it("refuses more than 160 characters", async () => {
    const cookie = await paired();
    const res = await sendAs(cookie, { text: "x".repeat(161) });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns Telnyx's STOP block (40300) into opted-out copy and remembers it", async () => {
    const cookie = await paired();
    fetchMock.mockResolvedValueOnce(telnyxReply(400, { errors: [{ code: "40300", detail: "Blocked due to STOP message" }] }));
    const res = await sendAs(cookie, { text: "hi" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("opted out");
    expect(await store.isOptedOut("+14155550123")).toBe(true);
  });
});

describe("POST /api/send (password mode)", () => {
  it("is off without SEND_FORM_PASSWORD", async () => {
    const res = await sendAs(null, { to: "+14155550123", text: "hi", password: "anything" });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends to any US number with the right password", async () => {
    vi.stubEnv("SEND_FORM_PASSWORD", "hunter2");
    fetchMock.mockResolvedValueOnce(telnyxReply(200, queued("m-pw", "+16465550199")));
    const res = await sendAs(null, { to: "+16465550199", text: "hi", password: "hunter2" });
    expect(res.status).toBe(200);
    expect(sentBody()).toMatchObject({ to: "+16465550199" });
  });
});

describe("GET /api/feed", () => {
  it("returns ver null when the feed is unknown, so the page keeps what it shows", async () => {
    expect(await feed()).toEqual({ ver: null, paired: null });
  });

  it("answers 'unchanged' when nothing moved", async () => {
    await hook(received("hello"));
    const first = await feed();
    expect(await feed(undefined, first.ver!)).toMatchObject({ ver: first.ver, unchanged: true });
  });

  it("asks Telnyx once for a late receipt", async () => {
    vi.stubEnv("RECEIPT_GRACE_MS", "0");
    const cookie = await paired();
    fetchMock.mockResolvedValueOnce(
      telnyxReply(200, { data: { id: "pong-1", to: [{ status: "delivery_failed" }], errors: [{ code: "40010", title: "Not 10DLC registered" }] } }),
    );
    const f = await feed(cookie);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.telnyx.com/v2/messages/pong-1");
    expect(f.items?.[0].status).toMatchObject({ key: "unregistered" });
    await feed(cookie);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks Telnyx again a minute later when the first lookup wasn't final", async () => {
    vi.stubEnv("RECEIPT_GRACE_MS", "0");
    const cookie = await paired();
    fetchMock.mockResolvedValueOnce(telnyxReply(200, { data: { id: "pong-1", to: [{ status: "sending" }] } }));
    expect((await feed(cookie)).items?.[0].status).toMatchObject({ key: "sending" });
    await feed(cookie);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 61_000);
    fetchMock.mockResolvedValueOnce(telnyxReply(200, { data: { id: "pong-1", to: [{ status: "delivered" }] } }));
    try {
      expect((await feed(cookie)).items?.[0].status).toMatchObject({ key: "delivered" });
    } finally {
      vi.useRealTimers();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("on a preview deployment, points to production and reads nothing", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "my-app.vercel.app");
    const res = (await (await feedGet(new Request("https://app.test/api/feed"))).json()) as FeedResponse;
    expect(res).toEqual({ preview: true, productionUrl: "https://my-app.vercel.app" });
    expect(mem.calls).toHaveLength(0);
  });
});
