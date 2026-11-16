import type { FeedResponse, PublicItem } from "./api/feed/route";

export type { FeedResponse, PublicItem };

export type SessionInfo = {
  code: string | null;
  expiresAt: number | null;
  smsHref: string;
  qrSvg: string;
  qrAlt: string;
  paired: { last4: string; canSend: boolean } | null;
};

/** The result of the last send from this page, for the delivery timeline. */
export type SendResult = { id?: string; error?: string; at: number };
