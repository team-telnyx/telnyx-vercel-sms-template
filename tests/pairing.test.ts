import { describe, expect, it } from "vitest";
import { ALPHABET, newCode, parseInbound } from "@/lib/pairing";

describe("newCode", () => {
  it("uses 4 symbols from an alphabet without look-alikes", () => {
    expect(ALPHABET).toHaveLength(32);
    for (const c of "0O1I") expect(ALPHABET).not.toContain(c);
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });
});

describe("parseInbound", () => {
  it.each([
    ["PING ABCD", "ping", ["ABCD"]],
    ["  ping abcd ", "ping", ["ABCD"]],
    ["abcd", "text", ["ABCD"]],
    ["PING", "ping", []],
    ["PINGABCD", "text", []],
    ["PING 0O1I", "ping", []],
    ["hello there", "text", []],
  ])("%j -> %s %j", (text, kind, codes) => {
    expect(parseInbound(text)).toEqual({ kind, codes });
  });

  it("finds at most 3 codes", () => {
    expect(parseInbound("AAAA BBBB CCCC DDDD").codes).toEqual(["AAAA", "BBBB", "CCCC"]);
  });

  it.each([
    ["STOP", "stop"],
    ["stop", "stop"],
    ["STOP ALL", "stop"],
    ["  Unsubscribe ", "stop"],
    ["START", "start"],
    ["UNSTOP", "start"],
    ["help", "help"],
  ])("keyword %j -> %s, never a code", (text, kind) => {
    expect(parseInbound(text)).toEqual({ kind, codes: [] });
  });

  it("only counts a keyword when it's the whole text", () => {
    expect(parseInbound("Stop please").kind).toBe("text");
    expect(parseInbound("HELP ME").kind).toBe("text");
  });

  it("trusts Telnyx's autoresponse_type over the text", () => {
    expect(parseInbound("Arrêter", "STOP")).toEqual({ kind: "stop", codes: [] });
    expect(parseInbound("PING ABCD", "START").kind).toBe("start");
    expect(parseInbound("aide", "help").kind).toBe("help");
  });
});
