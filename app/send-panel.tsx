"use client";
import { useId, useState } from "react";
import { MAX_TEXT } from "@/lib/limits";
import { DeliveryTimeline } from "./delivery-timeline";
import type { PublicItem, SendResult } from "./types";

async function postSend(body: Record<string, string>): Promise<SendResult> {
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    return res.ok ? { id: json.id, at: Date.now() } : { error: json.error ?? `The server returned HTTP ${res.status}.`, at: Date.now() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), at: Date.now() };
  }
}

/** Text the phone that paired with this page. */
export function SendPanel(props: {
  paired: { last4: string; canSend: boolean } | null;
  items: PublicItem[];
  registerHref: string;
  hasPassword: boolean;
  onSent: () => void;
}) {
  const [text, setText] = useState("Hello from Telnyx on Vercel");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const inputId = useId();
  const ready = Boolean(props.paired?.canSend);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(await postSend({ text }));
    setBusy(false);
    props.onSent();
  }

  return (
    <section className="card send" aria-labelledby="send-title">
      <h2 id="send-title">Send a text</h2>
      {!props.paired ? (
        <p className="muted">Text your number first. Then you can text that phone from here.</p>
      ) : !props.paired.canSend ? (
        <p className="muted">This page can only text US numbers. Your phone is {props.paired.last4}.</p>
      ) : null}
      <form className="send-form" onSubmit={submit} aria-disabled={!ready}>
        <label htmlFor={inputId} className="send-to">
          {props.paired ? (
            <>
              To your phone <b>{props.paired.last4}</b>
            </>
          ) : (
            "Message"
          )}
        </label>
        <div className="send-row">
          <input
            id={inputId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_TEXT}
            disabled={!ready || busy}
            required
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary" disabled={!ready || busy || !text.trim()}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
      {result ? (
        <DeliveryTimeline
          key={result.at}
          result={result}
          item={result.id ? props.items.find((i) => i.id === result.id) : undefined}
          registerHref={props.registerHref}
        />
      ) : null}
      {props.hasPassword ? <PasswordSend items={props.items} registerHref={props.registerHref} onSent={props.onSent} /> : null}
    </section>
  );
}

/** Optional: send to any US number, only when SEND_FORM_PASSWORD is set on the project. */
function PasswordSend({ items, registerHref, onSent }: { items: PublicItem[]; registerHref: string; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [text, setText] = useState("Hello from Telnyx on Vercel");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(await postSend({ to, text, password }));
    setBusy(false);
    onSent();
  }

  return (
    <details className="any-number">
      <summary>Send to any US number</summary>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">
          This password is the <code>SEND_FORM_PASSWORD</code> environment variable on your Vercel project.
        </p>
        <label>
          To
          <input placeholder="+14155550123" inputMode="tel" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} required />
        </label>
        <label>
          Message
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_TEXT} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
      {result ? (
        <DeliveryTimeline
          key={result.at}
          result={result}
          item={result.id ? items.find((i) => i.id === result.id) : undefined}
          registerHref={registerHref}
        />
      ) : null}
    </details>
  );
}
