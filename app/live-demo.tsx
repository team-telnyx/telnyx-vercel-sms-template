"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Hero } from "./hero";
import { MessagesPanel, type PollState } from "./messages-panel";
import { SendPanel } from "./send-panel";
import type { FeedResponse, PublicItem, SessionInfo } from "./types";

/**
 * Polling: every 2 s while the tab is visible, every 10 s after 2 minutes
 * without news, and off after 15 minutes ("Paused · Resume"). Errors back off
 * exponentially. Hidden tabs don't poll. This keeps one open tab to about 600
 * cache reads per 15 minutes.
 */
const FAST_MS = 2_000;
const SLOW_MS = 10_000;
const SLOW_AFTER_MS = 2 * 60_000;
const STOP_AFTER_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 30_000;

export function LiveDemo(props: {
  number: string;
  formatted: string;
  registerHref: string;
  hasPassword: boolean;
  middle: React.ReactNode;
}) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [items, setItems] = useState<PublicItem[]>([]);
  const [poll, setPoll] = useState<PollState>("connecting");
  const [toast, setToast] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const ver = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(Date.now());
  const lastChange = useRef(Date.now());
  const failures = useRef(0);
  const nullsAfterSend = useRef<number | null>(null);
  const pairedRef = useRef<string | null>(null);
  const sawUnpaired = useRef(false);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/session", { method: "POST" });
      if (!res.ok) return;
      const s = (await res.json()) as SessionInfo;
      setSession(s);
      pairedRef.current = s.paired?.last4 ?? null;
      if (!s.paired) sawUnpaired.current = true;
    } catch {
      // Try again on the next poll.
    }
  }, []);

  const tick = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (document.visibilityState !== "visible") return;
    const t = Date.now();
    if (t - startedAt.current > STOP_AFTER_MS) {
      setPoll("paused");
      return;
    }
    let delay = t - lastChange.current > SLOW_AFTER_MS ? SLOW_MS : FAST_MS;
    try {
      const qs = ver.current ? `?since=${ver.current}` : "";
      const res = await fetch(`/api/feed${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as FeedResponse;
      failures.current = 0;
      setPoll("live");
      if ("preview" in data) return;

      const nowPaired = data.paired?.last4 ?? null;
      if (nowPaired && nowPaired !== pairedRef.current) {
        if (sawUnpaired.current) setToast(`This page is linked to ${nowPaired}. You can text that phone from here.`);
        pairedRef.current = nowPaired;
        lastChange.current = Date.now();
        void loadSession();
      }
      if (data.ver === null) {
        if (nullsAfterSend.current !== null && ++nullsAfterSend.current >= 5) setUnavailable(true);
      } else {
        nullsAfterSend.current = null;
        setUnavailable(false);
        if (!data.unchanged && data.items) {
          const changed = data.ver !== ver.current || JSON.stringify(data.items) !== JSON.stringify(itemsRef.current);
          if (changed) {
            lastChange.current = Date.now();
            delay = FAST_MS;
            itemsRef.current = data.items;
            setItems(data.items);
          }
        }
        ver.current = data.ver;
      }
    } catch {
      failures.current++;
      delay = Math.min(MAX_BACKOFF_MS, FAST_MS * 2 ** failures.current);
    }
    setNow(Date.now());
    // Re-issue the pairing code when it's about to expire.
    if (session?.expiresAt && !pairedRef.current && session.expiresAt - Date.now() < 30_000) void loadSession();
    timer.current = setTimeout(tick, delay);
  }, [loadSession, session?.expiresAt]);
  const itemsRef = useRef<PublicItem[]>([]);

  const resume = useCallback(() => {
    startedAt.current = Date.now();
    lastChange.current = Date.now();
    setPoll("live");
    void tick();
  }, [tick]);

  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    // Wait until the page is visible: prerenders and background tabs never create codes.
    const start = () => {
      if (document.visibilityState !== "visible") return;
      if (!session) void loadSession();
      if (poll !== "paused") void tickRef.current();
    };
    start();
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else if (timer.current) clearTimeout(timer.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer.current) clearTimeout(timer.current);
    };
    // Run once on mount; the handlers read fresh state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const onSent = useCallback(() => {
    nullsAfterSend.current = 0;
    lastChange.current = Date.now();
    if (poll === "paused") resume();
    else void tickRef.current();
  }, [poll, resume]);

  return (
    <>
      <Hero number={props.number} formatted={props.formatted} session={session} />
      <MessagesPanel items={items} poll={poll} onResume={resume} now={now} toast={toast} unavailable={unavailable} />
      {props.middle}
      <SendPanel
        paired={session?.paired ?? null}
        items={items}
        registerHref={props.registerHref}
        hasPassword={props.hasPassword}
        onSent={onSent}
      />
    </>
  );
}
