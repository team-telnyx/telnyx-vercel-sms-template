/** Where the page's buttons go. */
import { withTarget } from "@/lib/format";

export const DOCS_URL = "https://telnyx-vercel-integration.vercel.app/docs";
export const REPO_URL = "https://github.com/team-telnyx/telnyx-vercel-sms-template";
export const SUPPORT_URL = "mailto:support@telnyx.com";
export const MARKETPLACE_URL = "https://vercel.com/marketplace/telnyx";

/** Opens the Telnyx integration in your Vercel team when TELNYX_DASHBOARD_URL isn't set yet. */
const INTEGRATION_FALLBACK = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fintegrations%2Ftelnyx&title=Open+Telnyx";

/**
 * A link into the Telnyx dashboard. TELNYX_DASHBOARD_URL is set by the
 * integration and signs you in through Vercel; `to` picks the page.
 */
export function dashboardLink(to: "messaging" | "verify" | "dashboard"): string {
  const base = process.env.TELNYX_DASHBOARD_URL?.trim();
  return base ? withTarget(base, to) : INTEGRATION_FALLBACK;
}
