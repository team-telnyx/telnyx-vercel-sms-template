import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/telnyx/voice/route";
import { decodeState, encodeState } from "@/lib/telnyx";

// A throwaway Ed25519 key pair; the public half plays TELNYX_PUBLIC_KEY.
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const rawPublic = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);

let n = 0;
function event(event_type: string, payload: Record<string, unknown>, id = `evt-${++n}`) {
  return { data: { id, event_type, record_type: "event", payload: { call_control_id: "v3:call", ...payload } } };
}

function signed(body: unknown, opts: { badSig?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.sign(null, Buffer.from(`${ts}|${opts.badSig ? raw + "x" : raw}`), privateKey).toString("base64");
  return new Request("http://localhost/api/telnyx/voice", {
    method: "POST",
    headers: { "telnyx-signature-ed25519": sig, "telnyx-timestamp": ts, "content-type": "application/json" },
    body: raw,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
function calls() {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
  }));
}

beforeEach(() => {
  vi.stubEnv("TELNYX_PUBLIC_KEY", rawPublic.toString("base64"));
  vi.stubEnv("TELNYX_API_KEY", "test-key");
  vi.stubEnv("TELNYX_CONNECTION_ID", "conn-1");
  fetchMock = vi.fn(async () => Response.json({ data: { result: "ok" } }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/telnyx/voice", () => {
  it("refuses a bad signature with 401 and sends nothing", async () => {
    const res = await POST(signed(event("call.initiated", { direction: "incoming" }), { badSig: true }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses everything with 401 when TELNYX_PUBLIC_KEY is missing", async () => {
    vi.stubEnv("TELNYX_PUBLIC_KEY", "");
    const res = await POST(signed(event("call.initiated", { direction: "incoming" })));
    expect(res.status).toBe(401);
  });

  it("answers an incoming call with step greet", async () => {
    const res = await POST(signed(event("call.initiated", { direction: "incoming" })));
    expect(res.status).toBe(200);
    const [c] = calls();
    expect(c.url).toBe("https://api.telnyx.com/v2/calls/v3%3Acall/actions/answer");
    expect(decodeState(c.body.client_state)).toEqual({ step: "greet" });
  });

  it("doesn't answer its own outgoing call", async () => {
    await POST(signed(event("call.initiated", { direction: "outgoing", client_state: encodeState({ step: "outbound" }) })));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the menu once answered", async () => {
    await POST(signed(event("call.answered", { client_state: encodeState({ step: "greet" }) })));
    const [c] = calls();
    expect(c.url).toMatch(/\/actions\/gather_using_speak$/);
    expect(c.body).toMatchObject({ voice: "female", language: "en-US", valid_digits: "12", maximum_digits: 1 });
    expect(decodeState(c.body.client_state)).toEqual({ step: "menu" });
  });

  it("speaks the message when the caller presses 1, then hangs up when it ends", async () => {
    await POST(signed(event("call.gather.ended", { digits: "1", client_state: encodeState({ step: "menu" }) })));
    await POST(signed(event("call.speak.ended", { client_state: encodeState({ step: "bye" }) })));
    const [speak, hangup] = calls();
    expect(speak.url).toMatch(/\/actions\/speak$/);
    expect(speak.body.payload).toBe("This call was answered by a Vercel Function. Goodbye.");
    expect(decodeState(speak.body.client_state)).toEqual({ step: "bye" });
    expect(hangup.url).toMatch(/\/actions\/hangup$/);
  });

  it("hangs up on 2 or no key", async () => {
    await POST(signed(event("call.gather.ended", { digits: "2", client_state: encodeState({ step: "menu" }) })));
    await POST(signed(event("call.gather.ended", { digits: "", client_state: encodeState({ step: "menu" }) })));
    expect(calls().map((c) => c.url.split("/").pop())).toEqual(["hangup", "hangup"]);
  });

  it("speaks a short message on an answered outbound call", async () => {
    await POST(signed(event("call.answered", { client_state: encodeState({ step: "outbound" }) })));
    const [c] = calls();
    expect(c.url).toMatch(/\/actions\/speak$/);
    expect(decodeState(c.body.client_state)).toEqual({ step: "bye" });
  });

  it("skips a duplicate event id", async () => {
    const e = event("call.initiated", { direction: "incoming" }, "evt-dup");
    const first = await POST(signed(e));
    const second = await POST(signed(e));
    expect(await first.json()).toEqual({ ok: true });
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for the command before it responds", async () => {
    let release!: () => void;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((r) => (release = () => r(Response.json({ data: {} })))),
    );
    let done = false;
    const pending = POST(signed(event("call.initiated", { direction: "incoming" }))).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    release();
    await pending;
    expect(done).toBe(true);
  });

  it("still answers 200 when Telnyx refuses a command", async () => {
    fetchMock.mockImplementationOnce(async () => Response.json({ errors: [{ code: "90018", title: "Call has already ended" }] }, { status: 422 }));
    const res = await POST(signed(event("call.gather.ended", { digits: "2", client_state: encodeState({ step: "menu" }) })));
    expect(res.status).toBe(200);
  });

  it("ignores other events with 200", async () => {
    const res = await POST(signed(event("call.hangup", {})));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 200 and logs 'voice not configured' without TELNYX_CONNECTION_ID", async () => {
    vi.stubEnv("TELNYX_CONNECTION_ID", "");
    const res = await POST(signed(event("call.initiated", { direction: "incoming" })));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("voice not configured"));
  });
});
