import { SendForm } from "./send-form";

export default function Home() {
  const key = process.env.TELNYX_API_KEY;
  const number = process.env.TELNYX_PHONE_NUMBER;
  const hasPassword = Boolean(process.env.SEND_FORM_PASSWORD);
  const webhook = process.env.TELNYX_MESSAGING_WEBHOOK_URL;
  const configured = Boolean(key && number);
  return (
    <main>
      <h1>Telnyx SMS on Vercel</h1>
      {configured ? (
        <p>
          Your number is <code>{number}</code>. Text it from any phone, and the message appears in your
          function logs for <code>/api/telnyx/inbound</code>.
        </p>
      ) : key ? (
        <p>
          <b>Waiting for your phone number.</b> Telnyx assigns it after a one-time identity check with a
          government photo ID and a selfie. Most checks finish within a few minutes, and some take up to
          24 hours. To start or check it, open <b>Telnyx</b> from the integration page in Vercel. When
          the number is assigned, Vercel adds <code>TELNYX_PHONE_NUMBER</code> to this project. Redeploy
          to use it.
        </p>
      ) : (
        <p>
          No Telnyx phone number yet. Add <b>Telnyx</b> from the Vercel Marketplace and connect it to
          this project. Vercel adds the <code>TELNYX_*</code> environment variables automatically. Then
          redeploy.
        </p>
      )}
      {configured && !webhook ? (
        <p>
          <small>
            Incoming texts don&apos;t reach this project yet. In Vercel, connect the phone number to this
            project. You can also set the number&apos;s inbound webhook to{" "}
            <code>https://&lt;your-domain&gt;/api/telnyx/inbound</code> yourself.
          </small>
        </p>
      ) : null}

      <h2>Send a message</h2>
      {configured && !hasPassword ? (
        <p>
          <small>
            Sending from this page is off until you set <code>SEND_FORM_PASSWORD</code> in the project&apos;s
            environment variables and redeploy. The password stops strangers from sending texts on your
            balance.
          </small>
        </p>
      ) : null}
      <SendForm disabled={!configured || !hasPassword} />

      <h2>Before US messaging registration</h2>
      <p>
        US carriers only deliver texts from registered business numbers. This registration is called
        10DLC. To register, open <b>Telnyx</b> from the integration page in Vercel and go to{" "}
        <b>Messaging</b>. You register your brand and submit a campaign that describes your messages.
        Telnyx reviews the campaign, usually in 1 to 3 business days, and the carriers then take about 3
        business days. The fees are shown before you submit and are paid from your prepaid balance. Your
        number is added to the campaign automatically once it&apos;s approved.
      </p>
      <ul>
        <li>
          <b>Works now.</b> Receiving texts from any phone in any country, sending to other US Telnyx
          numbers, signature checks and delivery receipts.
        </li>
        <li>
          <b>Works after approval.</b> Texts to US mobile phones, including the PONG reply. Until then,
          Telnyx refuses the send or the delivery receipt reports a carrier error.
        </li>
        <li>
          <b>Never works.</b> Texts to numbers outside the US. The messaging profile only allows US
          destinations.
        </li>
      </ul>

      <h2>How it works</h2>
      <ol>
        <li>
          <code>app/api/send/route.ts</code> sends an SMS with <code>POST /v2/messages</code>, behind{" "}
          <code>SEND_FORM_PASSWORD</code>.
        </li>
        <li>
          <code>app/api/telnyx/inbound/route.ts</code> receives incoming texts and delivery receipts,
          verifies their Ed25519 signature with <code>TELNYX_PUBLIC_KEY</code>, skips duplicates, and
          replies <b>PONG</b> to <b>PING</b>.
        </li>
      </ol>
    </main>
  );
}
