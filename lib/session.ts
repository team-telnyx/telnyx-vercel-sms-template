/** The browser session cookie that a pairing code links to a phone. */
import crypto from "node:crypto";
import { DAY_S } from "./limits";

export const SID_COOKIE = "tsms_sid";

export function readSid(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SID_COOKIE) {
      const v = rest.join("=");
      return /^[A-Za-z0-9_-]{22}$/.test(v) ? v : null;
    }
  }
  return null;
}

/** 128 random bits. */
export const newSid = () => crypto.randomBytes(16).toString("base64url");

export function sidCookie(sid: string, req: Request): string {
  const host = new URL(req.url).hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  return `${SID_COOKIE}=${sid}; Path=/; Max-Age=${DAY_S}; HttpOnly; SameSite=Lax${local ? "" : "; Secure"}`;
}
