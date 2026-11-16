"use client";
import { useId } from "react";
import { classifyErrorText, STATUS_COPY, type Classified } from "@/lib/status";
import type { PublicItem, SendResult } from "./types";

type StepState = "done" | "failed" | "active" | "waiting" | "unknown";

const ICON: Record<StepState, string> = { done: "✓", failed: "✗", active: "", waiting: "", unknown: "?" };
const SR: Record<StepState, string> = { done: "done", failed: "failed", active: "in progress", waiting: "waiting", unknown: "not confirmed" };

/** The three steps of a send, from the send response and the delivery receipts in the feed. */
export function DeliveryTimeline({
  result,
  item,
  registerHref,
}: {
  result: SendResult;
  item: PublicItem | undefined;
  registerHref: string;
}) {
  const c: Pick<Classified, "key" | "stage" | "code" | "title"> = result.error
    ? classifyErrorText(result.error)
    : (item?.status ?? { key: "accepted" });
  const titleId = useId();

  const failedAt = c.key === "unregistered" || c.key === "optedout" || c.key === "failed" ? (c.stage ?? 3) : null;
  const states: StepState[] = [1, 2, 3].map((n) => {
    if (failedAt === n) return "failed";
    if (failedAt !== null && n > failedAt) return "waiting";
    if (failedAt !== null && n < failedAt) return "done";
    if (n === 1) return "done";
    if (n === 2) return c.key === "accepted" || c.key === "sending" ? "active" : "done";
    if (c.key === "delivered") return "done";
    if (c.key === "unconfirmed") return "unknown";
    return c.key === "sent" ? "active" : "waiting";
  });

  let detail: string | null = null;
  if (failedAt) {
    if (c.key === "unregistered") detail = STATUS_COPY.unregistered;
    else if (c.key === "optedout") detail = STATUS_COPY.optedout;
    else detail = result.error && failedAt === 1 ? result.error : STATUS_COPY.failed(c);
  } else if (c.key === "unconfirmed") detail = STATUS_COPY.unconfirmed;

  return (
    <div className="delivery" role="group" aria-labelledby={titleId}>
      <h3 id={titleId}>Delivery</h3>
      <ol className="steps">
        {STATUS_COPY.steps.map((label, i) => {
          const s = states[i];
          const text = i === 2 && failedAt === 3 ? "Not delivered" : label;
          return (
            <li key={label} className={`step step-${s}`}>
              <span className="step-icon" aria-hidden="true">
                {ICON[s]}
              </span>
              <span>
                {text}
                <span className="sr-only">, {SR[s]}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {detail ? (
        <div className={`delivery-detail${failedAt ? " is-bad" : ""}`} role="status">
          <p>{c.key === "unregistered" ? "This number isn't registered for US texting yet." : detail}</p>
          {c.key === "unregistered" ? (
            <a className="btn btn-primary btn-small" href={registerHref}>
              Register for US messaging
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
