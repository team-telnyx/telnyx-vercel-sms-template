"use client";
import { useEffect, useRef } from "react";
import { relativeTime } from "@/lib/format";
import { StatusChip } from "./status-chip";
import type { PublicItem } from "./types";

export type PollState = "live" | "paused" | "connecting";

function systemLine(i: PublicItem): string | null {
  if (i.kind === "stop") return `${i.last4} opted out. This app won't text it again until it sends START.`;
  if (i.kind === "start") return `${i.last4} opted back in.`;
  if (i.kind === "nonus") return `No PONG for ${i.last4}: this app replies to US numbers only. Pairing still works.`;
  if (i.kind === "help") return `${i.last4} asked for help. Telnyx sent your help reply.`;
  return null;
}

export function MessagesPanel(props: {
  items: PublicItem[];
  poll: PollState;
  onResume: () => void;
  now: number;
  toast: string | null;
  unavailable: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const chronological = [...props.items].reverse();
  const newest = props.items[0]?.id;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newest]);

  return (
    <section className="card messages" aria-labelledby="messages-title">
      <div className="panel-head">
        <h2 id="messages-title">Messages</h2>
        {props.poll === "paused" ? (
          <button type="button" className="pill pill-paused" onClick={props.onResume}>
            Paused · Resume
          </button>
        ) : (
          <span className="pill pill-live">
            <span className="pulse" aria-hidden="true" />
            Listening
          </span>
        )}
      </div>

      {props.toast ? (
        <p className="toast" role="status">
          {props.toast}
        </p>
      ) : null}

      <ol ref={listRef} className="thread" aria-live="polite" aria-relevant="additions" aria-label="Messages, oldest first">
        {chronological.length === 0 ? (
          <li className="empty">
            <span className="dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            Waiting for your first text…
          </li>
        ) : (
          chronological.map((i) => {
            const sys = systemLine(i);
            if (sys) {
              return (
                <li key={i.id} className="sys">
                  {sys}
                </li>
              );
            }
            const when = relativeTime(i.at, props.now);
            return (
              <li key={i.id} className={`msg msg-${i.dir}${i.mine ? "" : " msg-masked"}`}>
                <div className="bubble">
                  {i.mine ? i.text : i.dir === "in" ? `Text from ${i.last4}` : `Text to ${i.last4}`}
                </div>
                <div className="meta">
                  {i.dir === "in" ? (
                    <span>
                      From {i.last4} · {when}
                    </span>
                  ) : (
                    <>
                      <span>{i.kind === "pong" ? "Auto-reply" : "Sent"} · {when}</span>
                      <StatusChip status={i.status} />
                    </>
                  )}
                </div>
                {i.kind === "pong" && i.status?.key === "unregistered" ? (
                  <p className="held">
                    Your app replied PONG. The carrier held it back until you register. <a href="#register">Why?</a>
                  </p>
                ) : null}
              </li>
            );
          })
        )}
      </ol>

      {props.unavailable ? (
        <p className="notice" role="status">
          Live messages aren&apos;t available right now. Check your function logs.
        </p>
      ) : null}
      <p className="footnote">Only the page linked to a phone sees its texts. Numbers are masked, and messages clear after 24 hours.</p>
    </section>
  );
}
