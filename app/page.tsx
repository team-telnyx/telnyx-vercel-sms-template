import { formatUs } from "@/lib/format";
import { dashboardLink, DOCS_URL, MARKETPLACE_URL, REPO_URL, SUPPORT_URL } from "./links";
import { LiveDemo } from "./live-demo";
import { RegisterCta } from "./register-cta";
import { SetupCard } from "./setup-card";
import { TravelDiagram } from "./travel-diagram";

/**
 * The home page. Environment variables are read at build time, so redeploy
 * after Vercel adds or changes them.
 */
export default function Home() {
  const number = process.env.TELNYX_PHONE_NUMBER;
  const connected = Boolean(process.env.TELNYX_PUBLIC_KEY && process.env.TELNYX_MESSAGING_WEBHOOK_URL);
  const preview = process.env.VERCEL_ENV === "preview";
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const registerHref = dashboardLink("messaging");

  let body: React.ReactNode;
  if (!process.env.TELNYX_TOKEN_URL && !process.env.TELNYX_API_KEY) {
    body = <SetupCard step="Step 1 of 3" text="Add Telnyx to this project." action={{ label: "Add Telnyx", href: MARKETPLACE_URL }} />;
  } else if (!number) {
    body = (
      <SetupCard
        step="Step 2 of 3"
        text="Verify your identity to get your number. Most checks take a few minutes."
        action={{ label: "Open Telnyx", href: dashboardLink("verify") }}
        note="Redeploy once your number arrives."
      />
    );
  } else if (!connected) {
    body = (
      <SetupCard
        step="Step 3 of 3"
        number={formatUs(number)}
        text="Connect your number to this project so texts reach it. Then redeploy."
        action={{ label: "Open Telnyx", href: dashboardLink("dashboard") }}
      />
    );
  } else if (preview) {
    body = (
      <SetupCard
        number={formatUs(number)}
        text="Live messages show on your production site."
        action={prod ? { label: "Open production →", href: `https://${prod}` } : undefined}
      />
    );
  } else {
    body = (
      <LiveDemo
        number={number}
        formatted={formatUs(number)}
        registerHref={registerHref}
        hasPassword={Boolean(process.env.SEND_FORM_PASSWORD)}
        middle={
          <>
            <TravelDiagram />
            <RegisterCta href={registerHref} docsHref={DOCS_URL} />
          </>
        }
      />
    );
  }

  return (
    <div className="page">
      <header className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>Telnyx SMS on Vercel</span>
      </header>
      <main id="main">{body}</main>
      <footer className="footer">
        <p>
          Edit <code>app/page.tsx</code> to make this page yours.
        </p>
        <nav aria-label="Resources">
          <a href={DOCS_URL}>Docs</a>
          <a href={REPO_URL}>GitHub</a>
          <a href={SUPPORT_URL}>Support</a>
        </nav>
      </footer>
    </div>
  );
}
