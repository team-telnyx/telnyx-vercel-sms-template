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
          Your number is <code>{number}</code>. Text it from any phone and the message arrives at{" "}
          <code>/api/telnyx/inbound</code> (see your function logs).
        </p>
      ) : key ? (
        <p>
          <b>Waiting for your number.</b> Telnyx assigns it after a one-time identity check (an ID
          and a selfie; accepted within minutes in most cases, up to 24 hours). Open <b>Telnyx</b>{" "}
          from the integration page in Vercel to start or check it. When the number is assigned,{" "}
          <code>TELNYX_PHONE_NUMBER</code> is added to this project: redeploy to pick it up.
        </p>
      ) : (
        <p>
          No Telnyx number yet. Add <b>Telnyx</b> from the Vercel Marketplace and connect it to this
          project; the <code>TELNYX_*</code> environment variables appear automatically. Then redeploy.
        </p>
      )}
      {configured && !webhook ? (
        <p>
          <small>
            Incoming texts are not routed here yet: connect the number to this project in Vercel (or set
            the inbound webhook on the number to <code>https://&lt;your-domain&gt;/api/telnyx/inbound</code>).
          </small>
        </p>
      ) : null}

      <h2>Send a message</h2>
      {configured && !hasPassword ? (
        <p>
          <small>
            Sending from this page is off until you set <code>SEND_FORM_PASSWORD</code> in the project&apos;s
            environment variables and redeploy. It stops strangers from texting on your balance.
          </small>
        </p>
      ) : null}
      <SendForm disabled={!configured || !hasPassword} />

      <h2>What works before US registration (10DLC)</h2>
      <p>
        US carriers block texts from business numbers until the number&apos;s 10DLC brand and campaign
        are approved. Register from the <b>Messaging</b> page of the Telnyx dashboard (open <b>Telnyx</b>{" "}
        from the integration in Vercel). Fees come out of your prepaid balance; carrier review typically
        takes 1–7 business days, and your number is attached automatically once approved.
      </p>
      <ul>
        <li>
          <b>Works now:</b> receiving texts from any phone, in any country; sending to other US Telnyx
          numbers; the signature check, delivery receipts and your code paths.
        </li>
        <li>
          <b>Waits for approval:</b> texts (including the PONG reply) to ordinary US mobiles. Until then
          the send is refused, or fails with a carrier error in its delivery receipt.
        </li>
        <li>
          <b>Never:</b> texts to numbers outside the US. The messaging profile allows US destinations only.
        </li>
      </ul>

      <h2>How it works</h2>
      <ol>
        <li>
          <code>app/api/send/route.ts</code> sends an SMS with <code>POST /v2/messages</code>, behind{" "}
          <code>SEND_FORM_PASSWORD</code>.
        </li>
        <li>
          <code>app/api/telnyx/inbound/route.ts</code> receives inbound messages and delivery receipts,
          verifies the Ed25519 signature with <code>TELNYX_PUBLIC_KEY</code>, dedupes, and replies{" "}
          <b>PONG</b> to <b>PING</b>.
        </li>
      </ol>
    </main>
  );
}
