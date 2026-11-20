import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as inbound } from "@/app/api/telnyx/inbound/route";
import { POST as send } from "@/app/api/send/route";
import {
  getMessageStatus,
  getTelnyxToken,
  resetTelnyxTokenForTests,
  sendSms,
  TelnyxError,
  verifyTelnyxWebhook,
} from "@/lib/telnyx";
import { setCacheForTests } from "@/lib/store";
import { memoryCache } from "./helpers";

// after() only works inside a Next.js request; the helper queues the callbacks instead.
vi.mock("next/server", () => import("./helpers"));

// The deployment's Vercel OIDC token, faked.
const oidcMock = vi.hoisted(() => vi.fn());
vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: oidcMock }));

// No test talks to Telnyx: the SDK's HTTP calls go to this fake fetch.
const fetchMock = vi.fn();

// A throwaway Ed25519 key pair standing in for the Telnyx webhook key.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const PUBLIC_KEY_B64 = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

function signedHeaders(body: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64");
  return { "content-type": "application/json", "telnyx-signature-ed25519": sig, "telnyx-timestamp": String(ts) };
}

function telnyxReply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const sent = { data: { id: "msg-1", to: [{ phone_number: "+14155550123", status: "queued" }] } };

beforeEach(() => {
  resetTelnyxTokenForTests();
  setCacheForTests(memoryCache().cache);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("TELNYX_API_KEY", "KEY_TEST");
  vi.stubEnv("TELNYX_PHONE_NUMBER", "+13125550100");
  vi.stubEnv("TELNYX_MESSAGING_PROFILE_ID", "profile-1");
  vi.stubEnv("TELNYX_PUBLIC_KEY", PUBLIC_KEY_B64);
  vi.stubEnv("SEND_FORM_PASSWORD", "hunter2");
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sendSms", () => {
  it("sends the same request as before: POST /v2/messages with the profile id", async () => {
    fetchMock.mockResolvedValueOnce(telnyxReply(200, sent));
    const msg = await sendSms("+14155550123", "hi");
    expect(msg.id).toBe("msg-1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.telnyx.com/v2/messages");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer KEY_TEST");
    expect(JSON.parse(init.body)).toEqual({
      from: "+13125550100",
      to: "+14155550123",
      text: "hi",
    });
  });

  it("turns a Telnyx error into a readable TelnyxError", async () => {
    fetchMock.mockResolvedValue(
      telnyxReply(422, { errors: [{ code: "40310", title: "Invalid 'to' address", detail: "Not a valid number" }] }),
    );
    const err = await sendSms("+14155550123", "hi").catch((e) => e);
    expect(err).toBeInstanceOf(TelnyxError);
    expect(err.message).toBe("Telnyx 422 (code 40310): Not a valid number");
    expect(err.status).toBe(422);
  });

  it("refuses to send without a way to get a token, or without a number", async () => {
    vi.stubEnv("TELNYX_API_KEY", "");
    vi.stubEnv("TELNYX_TOKEN_URL", "");
    await expect(sendSms("+14155550123", "hi")).rejects.toMatchObject({ status: 500 });
    vi.stubEnv("TELNYX_API_KEY", "KEY_TEST");
    vi.stubEnv("TELNYX_PHONE_NUMBER", "");
    await expect(sendSms("+14155550123", "hi")).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/send", () => {
  const call = (body: unknown) =>
    send(new Request("http://localhost/api/send", { method: "POST", body: JSON.stringify(body) }));

  it("checks the password", async () => {
    const res = await call({ to: "+14155550123", text: "hi", password: "wrong" });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only sends to US numbers", async () => {
    const res = await call({ to: "+447700900123", text: "hi", password: "hunter2" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the message id and status", async () => {
    fetchMock.mockResolvedValueOnce(telnyxReply(200, sent));
    const res = await call({ to: "+1 (415) 555-0123", text: "hi", password: "hunter2" });
    expect(await res.json()).toEqual({ id: "msg-1", status: "queued" });
  });

  it("shows the Telnyx error to the sender", async () => {
    fetchMock.mockResolvedValueOnce(telnyxReply(403, { errors: [{ code: "10039", detail: "Blocked" }] }));
    const res = await call({ to: "+14155550123", text: "hi", password: "hunter2" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Telnyx 403 (code 10039): Blocked" });
  });
});

describe("verifyTelnyxWebhook", () => {
  const body = JSON.stringify({ data: { id: "evt-1", event_type: "message.sent" } });
  const headersFor = (h: Record<string, string>) => new Headers(h);

  it("accepts a correctly signed body", async () => {
    expect(await verifyTelnyxWebhook(body, headersFor(signedHeaders(body)))).toEqual(JSON.parse(body));
  });

  it("rejects a tampered body, a stale timestamp, missing headers and a missing key", async () => {
    expect(await verifyTelnyxWebhook(body + " ", headersFor(signedHeaders(body)))).toBeNull();
    const old = Math.floor(Date.now() / 1000) - 301;
    expect(await verifyTelnyxWebhook(body, headersFor(signedHeaders(body, old)))).toBeNull();
    expect(await verifyTelnyxWebhook(body, new Headers())).toBeNull();
    vi.stubEnv("TELNYX_PUBLIC_KEY", "");
    expect(await verifyTelnyxWebhook(body, headersFor(signedHeaders(body)))).toBeNull();
  });
});

describe("POST /api/telnyx/inbound", () => {
  const event = (id: string, text: string) =>
    JSON.stringify({
      data: {
        id,
        event_type: "message.received",
        payload: { from: { phone_number: "+14155550123" }, text },
      },
    });
  const post = (body: string, headers = signedHeaders(body)) =>
    inbound(new Request("http://localhost/api/telnyx/inbound", { method: "POST", body, headers }));

  it("refuses an unsigned webhook", async () => {
    const res = await post(event("evt-unsigned", "PING"), { "content-type": "application/json" } as never);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a signed body that isn't JSON", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
  });

  it("replies PONG to PING, and the reply is sent before the response returns", async () => {
    let replySent = false;
    fetchMock.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 20));
      replySent = true;
      return telnyxReply(200, sent);
    });
    const res = await post(event("evt-ping", " ping "));
    expect(replySent).toBe(true);
    expect(res.status).toBe(200);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ to: "+14155550123", text: "PONG from your Vercel project" });
  });

  it("still answers 200 when the PONG reply fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(telnyxReply(500, { errors: [{ detail: "down" }] }));
    const res = await post(event("evt-ping-fail", "PING"));
    expect(res.status).toBe(200);
    // No automatic retry: a retried send could deliver the text twice.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not reply to other texts", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post(event("evt-hello", "hello"));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getTelnyxToken (Vercel OIDC)", () => {
  const TOKEN_URL = "https://vercel.telnyx.com/api/token";
  const HOUR = 60 * 60 * 1000;
  const tokenReply = (token: string, inMs: number) =>
    telnyxReply(200, {
      token,
      tokenType: "Bearer",
      expiresAt: new Date(Date.now() + inMs).toISOString(),
      phoneNumber: "+13125550100",
    });

  beforeEach(() => {
    vi.stubEnv("TELNYX_API_KEY", "");
    vi.stubEnv("TELNYX_TOKEN_URL", TOKEN_URL);
    oidcMock.mockReset();
    oidcMock.mockResolvedValue("VERCEL_OIDC_TEST");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exchanges the Vercel OIDC token, then sends with the Telnyx token", async () => {
    fetchMock.mockResolvedValueOnce(tokenReply("TNX_SHORT_1", HOUR)).mockResolvedValueOnce(telnyxReply(200, sent));
    const msg = await sendSms("+14155550123", "hi");
    expect(msg.id).toBe("msg-1");

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toBe(TOKEN_URL);
    expect(tokenInit.method).toBe("POST");
    expect(new Headers(tokenInit.headers).get("authorization")).toBe("Bearer VERCEL_OIDC_TEST");
    expect(JSON.parse(tokenInit.body)).toEqual({ phoneNumber: "+13125550100" });

    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe("https://api.telnyx.com/v2/messages");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer TNX_SHORT_1");
  });

  it("never sends the Vercel OIDC token to Telnyx", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenReply("TNX_SHORT_1", HOUR))
      .mockResolvedValueOnce(telnyxReply(200, sent))
      .mockResolvedValueOnce(telnyxReply(200, sent));
    await sendSms("+14155550123", "hi");
    await getMessageStatus("msg-1");
    const telnyxCalls = fetchMock.mock.calls.filter(([url]) => new URL(String(url)).host === "api.telnyx.com");
    expect(telnyxCalls).toHaveLength(2);
    for (const [, init] of telnyxCalls) {
      expect(JSON.stringify([...new Headers(init.headers)])).not.toContain("VERCEL_OIDC_TEST");
      expect(String(init.body ?? "")).not.toContain("VERCEL_OIDC_TEST");
    }
  });

  it("reuses the token, and concurrent callers share one request", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url) === TOKEN_URL ? tokenReply("TNX_SHORT_1", HOUR) : telnyxReply(200, sent),
    );
    await Promise.all([sendSms("+14155550123", "a"), sendSms("+14155550123", "b")]);
    await sendSms("+14155550123", "c");
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url) === TOKEN_URL);
    expect(tokenCalls).toHaveLength(1);
    expect(oidcMock).toHaveBeenCalledTimes(1);
  });

  it("gets a new token within 5 minutes of expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock
      .mockResolvedValueOnce(tokenReply("TNX_SHORT_1", HOUR))
      .mockResolvedValueOnce(telnyxReply(200, sent))
      .mockResolvedValueOnce(tokenReply("TNX_SHORT_2", HOUR))
      .mockResolvedValueOnce(telnyxReply(200, sent));
    await sendSms("+14155550123", "a");
    vi.setSystemTime(Date.now() + HOUR - 4 * 60 * 1000);
    await sendSms("+14155550123", "b");
    expect(String(fetchMock.mock.calls[2][0])).toBe(TOKEN_URL);
    const [, init] = fetchMock.mock.calls[3];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer TNX_SHORT_2");
  });

  it("uses TELNYX_API_KEY when the project still has one", async () => {
    vi.stubEnv("TELNYX_API_KEY", "KEY_LEGACY");
    await expect(getTelnyxToken()).resolves.toBe("KEY_LEGACY");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(oidcMock).not.toHaveBeenCalled();
  });

  it("says what to do when TELNYX_TOKEN_URL isn't set", async () => {
    vi.stubEnv("TELNYX_TOKEN_URL", "");
    const err = await sendSms("+14155550123", "hi").catch((e) => e);
    expect(err).toBeInstanceOf(TelnyxError);
    expect(err.message).toMatch(/TELNYX_TOKEN_URL isn't set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says to run vercel env pull when there is no OIDC token", async () => {
    oidcMock.mockRejectedValueOnce(new Error("no token"));
    const err = await getTelnyxToken().catch((e) => e);
    expect(err.message).toMatch(/vercel env pull/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains a 403: the project isn't connected to the number", async () => {
    fetchMock.mockResolvedValueOnce(
      telnyxReply(403, {
        error: { code: "not_connected", message: "This project isn't connected to a Telnyx number in its development environment. Connect the number to the project in Vercel." },
      }),
    );
    const err = await sendSms("+14155550123", "hi").catch((e) => e);
    expect(err).toBeInstanceOf(TelnyxError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("not_connected");
    expect(err.message).toBe(
      "Telnyx token 403 (not_connected): This project isn't connected to a Telnyx number in its development environment. Connect the number to the project in Vercel.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes on other token errors", async () => {
    fetchMock.mockResolvedValueOnce(telnyxReply(429, { error: { code: "rate_limited", message: "Too many requests" } }));
    const err = await getTelnyxToken().catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.message).toBe("Telnyx token 429 (rate_limited): Too many requests");
  });

  it("asks Vercel for an OIDC token addressed to Telnyx", async () => {
    fetchMock.mockResolvedValueOnce(tokenReply("TNX_SHORT_1", HOUR)).mockResolvedValueOnce(telnyxReply(200, sent));
    await sendSms("+14155550123", "hi");
    expect(oidcMock).toHaveBeenCalledWith({ audience: "https://vercel.telnyx.com" });
  });

  it("on a Telnyx 401, exchanges again once and retries once", async () => {
    const unauthorized = () => telnyxReply(401, { errors: [{ code: "10009", detail: "Authentication failed" }] });
    fetchMock
      .mockResolvedValueOnce(tokenReply("TNX_SHORT_1", HOUR))
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(tokenReply("TNX_SHORT_2", HOUR))
      .mockResolvedValueOnce(telnyxReply(200, sent));
    const msg = await sendSms("+14155550123", "hi");
    expect(msg.id).toBe("msg-1");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Headers(fetchMock.mock.calls[3][1].headers).get("authorization")).toBe("Bearer TNX_SHORT_2");

    // A second 401 is passed on: no loop.
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(tokenReply("TNX_SHORT_3", HOUR))
      .mockResolvedValueOnce(unauthorized());
    const err = await sendSms("+14155550123", "hi").catch((e) => e);
    expect(err).toBeInstanceOf(TelnyxError);
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never retries a 401 with TELNYX_API_KEY", async () => {
    vi.stubEnv("TELNYX_API_KEY", "KEY_TEST");
    fetchMock.mockResolvedValueOnce(telnyxReply(401, { errors: [{ code: "10009", detail: "Authentication failed" }] }));
    const err = await sendSms("+14155550123", "hi").catch((e) => e);
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
