"use client";
import { useState } from "react";
import { pingText } from "@/lib/format";
import type { SessionInfo } from "./types";

export function Hero({ number, formatted, session }: { number: string; formatted: string; session: SessionInfo | null }) {
  const [copied, setCopied] = useState(false);
  const ping = session ? pingText(session.code) : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(number);
    } catch {
      // Older browsers: select the number so it can be copied by hand.
      const el = document.getElementById("hero-number");
      if (el) window.getSelection()?.selectAllChildren(el);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="card hero" aria-labelledby="hero-label">
      <div className="hero-main">
        <p id="hero-label" className="eyebrow">
          Your Telnyx number
        </p>
        <h1 id="hero-number" className="hero-number">
          {formatted}
        </h1>
        <p className="hero-line">Text it from your phone. The message shows up here in a second.</p>
        <div className="actions">
          <button type="button" className="btn btn-copy" onClick={copy}>
            <span aria-live="polite">{copied ? "Copied" : "Copy number"}</span>
          </button>
          <a className="btn btn-sms" href={session?.smsHref ?? `sms:${number}`}>
            Open Messages
          </a>
        </div>
        <p className="code-line">
          {session?.paired ? (
            <>
              Linked to your phone <b>{session.paired.last4}</b>
            </>
          ) : ping ? (
            <>
              Your code is <b className="mono">{ping}</b>. It links this page to your phone.
            </>
          ) : (
            <span className="muted">Getting your code…</span>
          )}
        </p>
      </div>
      {session ? (
        <figure className="qr">
          {/* A data URI from our own server-rendered SVG: no extra request, real alt text. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(session.qrSvg)}`} alt={session.qrAlt} width={132} height={132} />
          <figcaption>Scan to text from your phone</figcaption>
        </figure>
      ) : (
        <div className="qr qr-placeholder" aria-hidden="true" />
      )}
    </section>
  );
}
