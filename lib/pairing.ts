/**
 * Pairing codes link a browser to the phone that texts the code, and the
 * parser decides what an inbound text means.
 */
import crypto from "node:crypto";

/** 32 symbols with no look-alikes (no 0/O, no 1/I). */
export const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;

export function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

/**
 * Telnyx's default keywords. Telnyx handles them on the messaging profile:
 * it blocks or unblocks the sender and sends the confirmation text itself,
 * so this app never replies to them.
 */
const STOP_WORDS = new Set(["STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP"]);
const HELP_WORDS = new Set(["HELP"]);

export type InboundKind = "stop" | "start" | "help" | "ping" | "text";

const CODE_TOKEN = /\b[A-HJ-NP-Z2-9]{4}\b/g;

/**
 * `autoresponseType` is Telnyx's `payload.autoresponse_type` (STOP, START or
 * HELP). It wins, because it reflects what Telnyx actually did. The keyword
 * match is a fallback and only counts when the whole text is the keyword.
 */
export function parseInbound(
  text: string | undefined | null,
  autoresponseType?: string | null,
): { kind: InboundKind; codes: string[] } {
  const auto = autoresponseType?.trim().toUpperCase();
  if (auto === "STOP") return { kind: "stop", codes: [] };
  if (auto === "START") return { kind: "start", codes: [] };
  if (auto === "HELP") return { kind: "help", codes: [] };

  const upper = (text ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (STOP_WORDS.has(upper)) return { kind: "stop", codes: [] };
  if (START_WORDS.has(upper)) return { kind: "start", codes: [] };
  if (HELP_WORDS.has(upper)) return { kind: "help", codes: [] };

  const kind: InboundKind = /^PING\b/.test(upper) ? "ping" : "text";
  const codes: string[] = [];
  for (const m of upper.matchAll(CODE_TOKEN)) {
    if (m[0] === "PING" || codes.includes(m[0])) continue;
    codes.push(m[0]);
    if (codes.length === 3) break;
  }
  return { kind, codes };
}
