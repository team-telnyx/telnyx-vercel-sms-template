import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "@/lib/store";
import { classify } from "@/lib/status";
import { memoryCache } from "./helpers";

let mem: ReturnType<typeof memoryCache>;
beforeEach(() => {
  vi.stubEnv("TELNYX_PHONE_NUMBER", "+13125550100");
  mem = memoryCache();
  store.setCacheForTests(mem.cache);
});
afterEach(() => vi.unstubAllEnvs());

const item = (id: string, at: number): store.FeedItem => ({ id, dir: "in", last4: "•••0123", nh: "h", text: "hi", at });

describe("store", () => {
  it("hashes keys and names entries by kind only, so numbers never reach the cache or its logs", async () => {
    await store.setOptOut("+14155550123", true);
    await store.setSession("sid-1", "+14155550123", "•••0123");
    await store.bump("rl:n:+14155550123:1", 60);
    for (const c of mem.calls) {
      expect(c.key).toMatch(/^tsms13125550100\$[0-9a-f]{40}$/);
      expect(c.key).not.toContain("4155550123");
    }
    expect(mem.calls.filter((c) => c.op === "set").map((c) => c.name)).toEqual(["optout", "sess", "rl"]);
  });

  it("keeps the newest 20 feed items, newest first, and passes a 24-hour TTL", async () => {
    for (let i = 0; i < 25; i++) await store.pushFeed([item(`m${i}`, 1000 + i)]);
    const feed = await store.getFeed();
    expect(feed?.items).toHaveLength(20);
    expect(feed?.items[0].id).toBe("m24");
    expect(mem.calls.find((c) => c.op === "set" && c.name === "feed")?.ttl).toBe(86_400);
  });

  it("trims feed text to 160 characters", async () => {
    await store.pushFeed([{ ...item("long", 1), text: "x".repeat(400) }]);
    expect((await store.getFeed())?.items[0].text).toHaveLength(160);
  });

  it("reuses a browser's pairing code instead of writing a new one", async () => {
    const a = await store.newPairing("sid-1");
    const writes = mem.calls.filter((c) => c.op === "set").length;
    const b = await store.newPairing("sid-1");
    expect(b.code).toBe(a.code);
    expect(mem.calls.filter((c) => c.op === "set").length).toBe(writes);
    expect(mem.calls.find((c) => c.name === "pair")?.ttl).toBe(900);
  });

  it("claims a pairing code once", async () => {
    const { code } = await store.newPairing("sid-1");
    expect(await store.claimPairing(code)).toBe("sid-1");
    expect(await store.claimPairing(code)).toBeNull();
  });

  it("writes statuses forward-only", async () => {
    await store.setStatus("m1", classify({ status: "delivered" }));
    await store.setStatus("m1", classify({ status: "sent" }));
    expect((await store.getStatus("m1"))?.key).toBe("delivered");
  });

  it("sees an event id once", async () => {
    expect(await store.firstSeen("evt-1")).toBe(true);
    expect(await store.firstSeen("evt-1")).toBe(false);
  });

  it("treats a failing cache as unknown, never as an error", async () => {
    store.setCacheForTests(memoryCache({ failing: true }).cache);
    await store.pushFeed([item("a", 1)]);
    expect(await store.getFeed()).toBeNull();
    expect(await store.isOptedOut("+14155550123")).toBe(false);
    expect(await store.count("rl:day:20260101")).toBe(0);
  });
});
