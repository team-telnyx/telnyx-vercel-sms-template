/**
 * Turns Telnyx message statuses and error codes into the three-step delivery
 * timeline on the home page: Accepted by Telnyx, Handed to the carrier,
 * Delivered. Pure functions, used on the server and in the browser.
 */

export type StatusKey =
  | "accepted"
  | "sending"
  | "sent"
  | "delivered"
  | "unconfirmed"
  | "unregistered"
  | "optedout"
  | "failed";

/** Which timeline step a failure belongs to. */
export type Stage = 1 | 2 | 3;

export type Classified = {
  key: StatusKey;
  /** Higher ranks win: receipts can arrive out of order, and a status never moves backwards. */
  rank: number;
  /** The step that failed, for failures only. */
  stage?: Stage;
  code?: string;
  title?: string;
};

export type TelnyxErrorLike = { code?: string | number | null; title?: string | null; detail?: string | null };

const RANK: Record<StatusKey, number> = {
  accepted: 1,
  sending: 2,
  sent: 3,
  unconfirmed: 8,
  delivered: 9,
  unregistered: 9,
  optedout: 9,
  failed: 9,
};

export const isFinal = (key: StatusKey | undefined) => key !== undefined && RANK[key] >= 8;

/**
 * Telnyx documents the "not registered for US texting (10DLC)" failure under
 * more than one code (40010, 40300 and 47000 appear in different pages), so the
 * match uses the codes and the error text together.
 */
const UNREGISTERED_CODES = new Set(["40010", "47000"]);
const UNREGISTERED_TEXT = /10\s?DLC|not registered|unregistered|campaign required/i;
const OPTED_OUT_TEXT = /\bSTOP\b|block rule|opted? out|unsubscribed/i;
const US_ONLY_CODE = "40309";

function failure(errors: TelnyxErrorLike[] | undefined, stage: Stage): Classified {
  const first = errors?.find(Boolean);
  const code = first?.code != null && first.code !== "" ? String(first.code) : undefined;
  const words = (errors ?? []).map((e) => `${e?.title ?? ""} ${e?.detail ?? ""}`).join(" ");
  const title = first?.title || first?.detail || undefined;
  const base = { rank: 9, stage, code, title: title ?? undefined };
  if (code === "40300" && OPTED_OUT_TEXT.test(words)) return { ...base, key: "optedout" };
  if ((code && UNREGISTERED_CODES.has(code)) || code === "40300" || UNREGISTERED_TEXT.test(words)) {
    return { ...base, key: "unregistered" };
  }
  if (OPTED_OUT_TEXT.test(words)) return { ...base, key: "optedout" };
  if (code === US_ONLY_CODE) return { ...base, key: "failed", title: "Telnyx only texts US numbers from this integration." };
  return { ...base, key: "failed" };
}

/**
 * Classify a status from a send response or a webhook (`to[0].status` plus
 * `errors[]`), or a synchronous send error.
 */
export function classify(input: { status?: string | null; errors?: TelnyxErrorLike[]; syncError?: TelnyxErrorLike }): Classified {
  if (input.syncError) return failure([input.syncError], 1);
  switch (input.status) {
    case "queued":
    case "accepted":
      return { key: "accepted", rank: RANK.accepted };
    case "sending":
      return { key: "sending", rank: RANK.sending };
    case "sent":
      return { key: "sent", rank: RANK.sent };
    case "delivered":
      return { key: "delivered", rank: RANK.delivered };
    case "delivery_unconfirmed":
      return { key: "unconfirmed", rank: RANK.unconfirmed };
    case "sending_failed":
      return failure(input.errors, 2);
    case "delivery_failed":
    case "expired":
      return failure(input.errors, 3);
    default:
      return { key: "accepted", rank: RANK.accepted };
  }
}

/** Forward-only: a new status replaces the stored one only when it ranks at least as high. */
export function shouldReplace(prev: Pick<Classified, "rank"> | null | undefined, next: Pick<Classified, "rank">): boolean {
  return !prev || next.rank >= prev.rank;
}

/**
 * The send route returns `{ error }` with Telnyx's text, for example
 * "Telnyx 400 (code 40010): Not 10DLC registered". This reads it back.
 */
export function classifyErrorText(message: string): Classified {
  const code = /\(code (\d+)\)/.exec(message)?.[1];
  const detail = message.replace(/^Telnyx \d+(?: \(code \d+\))?: /, "");
  return failure([{ code, detail }], 1);
}

export const STATUS_COPY = {
  steps: ["Accepted by Telnyx", "Handed to the carrier", "Delivered"] as const,
  delivered: "Delivered",
  unregistered: "Not delivered. This number isn't registered for US texting yet.",
  optedout: "This phone opted out. Text START to your number to opt back in.",
  unconfirmed: "The carrier didn't confirm delivery.",
  failed: (c: Pick<Classified, "title" | "code">) =>
    `Not delivered: ${c.title ?? "Telnyx reported an error"}${c.code ? ` (code ${c.code})` : ""}.`,
};
