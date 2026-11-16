import { describe, expect, it } from "vitest";
import { classify, classifyErrorText, isFinal, shouldReplace, STATUS_COPY } from "@/lib/status";

describe("classify", () => {
  it.each([
    ["queued", "accepted", 1],
    ["sending", "sending", 2],
    ["sent", "sent", 3],
    ["delivered", "delivered", 9],
    ["delivery_unconfirmed", "unconfirmed", 8],
  ])("%s -> %s", (status, key, rank) => {
    expect(classify({ status })).toMatchObject({ key, rank });
  });

  it.each(["40010", "47000", "40300"])("code %s on a failed delivery means not registered for US texting", (code) => {
    expect(classify({ status: "delivery_failed", errors: [{ code, title: "Message failed" }] })).toMatchObject({
      key: "unregistered",
      stage: 3,
      code,
    });
  });

  it("matches the not-registered wording even with another code", () => {
    expect(classify({ status: "delivery_failed", errors: [{ code: "40999", detail: "10DLC campaign required" }] }).key).toBe(
      "unregistered",
    );
    expect(classify({ status: "sending_failed", errors: [{ title: "Number not registered" }] })).toMatchObject({
      key: "unregistered",
      stage: 2,
    });
  });

  it("tells a STOP block (40300) apart from a registration failure (40300)", () => {
    expect(classify({ syncError: { code: "40300", detail: "Blocked due to STOP message" } })).toMatchObject({
      key: "optedout",
      stage: 1,
    });
    expect(classify({ syncError: { code: "40300", detail: "Number not registered for 10DLC" } }).key).toBe("unregistered");
  });

  it("keeps Telnyx's title and code for other failures", () => {
    const c = classify({ status: "delivery_failed", errors: [{ code: "40002", title: "Blocked as spam" }] });
    expect(c).toMatchObject({ key: "failed", code: "40002", title: "Blocked as spam" });
    expect(STATUS_COPY.failed(c)).toBe("Not delivered: Blocked as spam (code 40002).");
  });

  it("explains 40306 (non-US destination) as US-only", () => {
    expect(classify({ syncError: { code: "40306" } }).title).toBe("Telnyx only texts US numbers from this integration.");
  });

  it("explains 40309 (destination not allowed)", () => {
    expect(classify({ syncError: { code: "40309" } }).title).toBe("Telnyx only texts US numbers from this integration.");
  });

  it("reads the send route's error text back", () => {
    expect(classifyErrorText("Telnyx 400 (code 40010): Not 10DLC registered").key).toBe("unregistered");
    expect(classifyErrorText("Telnyx 403 (code 10039): Blocked")).toMatchObject({ key: "failed", code: "10039" });
  });
});

describe("shouldReplace", () => {
  it("is forward-only: a late 'sent' never replaces 'delivered'", () => {
    const delivered = classify({ status: "delivered" });
    const sent = classify({ status: "sent" });
    expect(shouldReplace(delivered, sent)).toBe(false);
    expect(shouldReplace(sent, delivered)).toBe(true);
    expect(shouldReplace(null, sent)).toBe(true);
    expect(isFinal("delivered")).toBe(true);
    expect(isFinal("sent")).toBe(false);
  });
});
