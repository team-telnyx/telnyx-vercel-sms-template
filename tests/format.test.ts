import { describe, expect, it } from "vitest";
import { formatUs, last4, qrPayload, relativeTime, smsHref, withTarget } from "@/lib/format";

describe("format", () => {
  it("masks and formats numbers", () => {
    expect(last4("+14155550123")).toBe("•••0123");
    expect(formatUs("+14155550123")).toBe("+1 (415) 555-0123");
    expect(formatUs("+447700900123")).toBe("+447700900123");
  });

  it("builds Messages links per platform and the QR payload", () => {
    expect(smsHref("+14155550123", "AB2C", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe("sms:+14155550123&body=PING%20AB2C");
    expect(smsHref("+14155550123", "AB2C", "Mozilla/5.0 (Linux; Android 14)")).toBe("sms:+14155550123?body=PING%20AB2C");
    expect(smsHref("+14155550123", null)).toBe("sms:+14155550123?body=PING");
    expect(qrPayload("+14155550123", "AB2C")).toBe("SMSTO:+14155550123:PING AB2C");
  });

  it("adds a target to dashboard links", () => {
    expect(withTarget("https://example.com/open/x", "messaging")).toBe("https://example.com/open/x?to=messaging");
    expect(withTarget("https://example.com/d?a=1", "verify")).toBe("https://example.com/d?a=1&to=verify");
    expect(relativeTime(0, 10_000)).toBe("just now");
    expect(relativeTime(0, 5 * 60_000)).toBe("5 min ago");
  });
});
