"use client";
import { useState } from "react";

export function CallForm({ disabled }: { disabled: boolean }) {
  const [to, setTo] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult("Calling…");
    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, password }),
      });
      const json = (await res.json().catch(() => ({}))) as { call_control_id?: string; error?: string };
      setResult(
        res.ok
          ? "Telnyx is placing the call. Your phone should ring in a few seconds. Call events arrive at /api/telnyx/voice."
          : `Not called. ${json.error ?? `The server returned HTTP ${res.status}.`}`,
      );
    } catch (err) {
      setResult(`Not called. ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, margin: "16px 0" }}>
      <label>
        Your phone (US number)
        <input style={{ width: "100%" }} placeholder="+14155550123" inputMode="tel" value={to} onChange={(e) => setTo(e.target.value)} disabled={disabled} required />
      </label>
      <label>
        Send form password
        <input style={{ width: "100%" }} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={disabled} required />
      </label>
      <button type="submit" disabled={disabled || busy}>Call me</button>
      {result ? <small role="status">{result}</small> : null}
    </form>
  );
}
