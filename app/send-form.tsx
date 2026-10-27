"use client";
import { useState } from "react";

export function SendForm({ disabled }: { disabled: boolean }) {
  const [to, setTo] = useState("");
  const [text, setText] = useState("Hello from Vercel via Telnyx");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult("sending…");
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, text, password }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; status?: string; error?: string };
      setResult(
        res.ok
          ? `Accepted by Telnyx (id ${json.id}${json.status ? `, ${json.status}` : ""}). Delivery receipts arrive at /api/telnyx/inbound.`
          : `Failed: ${json.error ?? `HTTP ${res.status}`}`,
      );
    } catch (err) {
      setResult(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, margin: "16px 0" }}>
      <label>
        To (US number)
        <input style={{ width: "100%" }} placeholder="+14155550123" inputMode="tel" value={to} onChange={(e) => setTo(e.target.value)} disabled={disabled} required />
      </label>
      <label>
        Message
        <input style={{ width: "100%" }} value={text} onChange={(e) => setText(e.target.value)} disabled={disabled} required maxLength={1600} />
      </label>
      <label>
        Password (SEND_FORM_PASSWORD)
        <input style={{ width: "100%" }} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={disabled} required />
      </label>
      <button type="submit" disabled={disabled || busy}>Send SMS</button>
      {result ? <small role="status">{result}</small> : null}
    </form>
  );
}
