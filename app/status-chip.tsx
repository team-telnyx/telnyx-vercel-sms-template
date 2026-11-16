import type { PublicItem } from "./types";

/** Delivery status for a text this app sent. Text plus an icon, never colour alone. */
export function StatusChip({ status }: { status: PublicItem["status"] }) {
  const key = status?.key ?? "accepted";
  const [tone, label] =
    key === "delivered"
      ? (["ok", "Delivered ✓"] as const)
      : key === "unregistered"
        ? (["bad", "Held by the carrier ✗"] as const)
        : key === "optedout"
          ? (["bad", "Opted out ✗"] as const)
          : key === "failed"
            ? (["bad", "Not delivered ✗"] as const)
            : key === "unconfirmed"
              ? (["warn", "Not confirmed ?"] as const)
              : key === "sent"
                ? (["pending", "With the carrier…"] as const)
                : (["pending", "Sending…"] as const);
  return <span className={`chip chip-${tone}`}>{label}</span>;
}
