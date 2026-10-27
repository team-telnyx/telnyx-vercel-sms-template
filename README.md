# Telnyx SMS on Vercel

The smallest useful Next.js app for a Telnyx phone number bought through the [Vercel Marketplace](https://vercel.com/marketplace/telnyx): send an SMS from a password-protected form, receive inbound messages and delivery receipts on a signed webhook, and reply **PONG** to **PING**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fteam-telnyx%2Ftelnyx-vercel-sms-template&project-name=telnyx-sms&repository-name=telnyx-sms&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22telnyx%22%2C%22productSlug%22%3A%22phone-number%22%2C%22protocol%22%3A%22storage%22%7D%5D&env=SEND_FORM_PASSWORD&envDescription=Choose%20a%20password%20for%20the%20demo%20send%20form%2C%20so%20strangers%20cannot%20text%20on%20your%20Telnyx%20balance.&envLink=https%3A%2F%2Fgithub.com%2Fteam-telnyx%2Ftelnyx-vercel-sms-template%23environment-variables)

The button clones this repo, asks you for a `SEND_FORM_PASSWORD`, and adds **Telnyx** (product *SMS Phone Number (US)*) to the new project.

## Before you start

- **US only.** Numbers are US local numbers, and the messaging profile allows US destinations only.
- **Prepaid.** You buy credit in Vercel (from $10); it is booked as Telnyx credit and pays for the number ($1/month), messages and 10DLC registration fees at public Telnyx rates. Refunds are handled by Telnyx support on request.
- **Identity check.** Telnyx creates an account for your Vercel installation. Before a number is assigned, the account owner completes a one-time identity check (a government ID and a selfie, via Onfido). Most checks pass within minutes; some take up to 24 hours. Open **Telnyx** from the integration page in Vercel to start it.
- **10DLC for US recipients.** See [What works before 10DLC approval](#what-works-before-10dlc-approval).

## Run it

1. Click **Deploy**. Choose a password for the send form, add Telnyx, pick *Pay as you go*, and add credit.
2. Open **Telnyx** from the integration page in Vercel and complete the identity check. When it is accepted your number is assigned and `TELNYX_PHONE_NUMBER` is added to the project.
3. **Redeploy** the project (Deployments > Redeploy) so it picks up the new variables. The home page shows your number once they are in.
4. Text **PING** to your number from any phone: the message shows up in your function logs (Project > Logs, `/api/telnyx/inbound`). Connecting the number to the project points its inbound webhook at `https://<production-domain>/api/telnyx/inbound` for you.
5. Send a message from the form on the home page (US numbers only, with your password).
6. To text ordinary US mobiles, register your 10DLC brand and campaign on the **Messaging** page of the Telnyx dashboard.

Adding Telnyx to an existing project instead: add it from the Marketplace, connect the number to your project, then copy `app/api/telnyx/inbound/route.ts` and `lib/telnyx.ts`.

## What works before 10DLC approval

US carriers block texts from business numbers until the number is attached to an approved 10DLC campaign. Register a brand and a campaign on the dashboard's **Messaging** page (open **Telnyx** from the integration in Vercel). The fees are quoted before you submit and come out of your prepaid balance. Carrier review typically takes 1 to 7 business days; your number is attached automatically when the campaign is approved.

| | Before approval | After approval |
| --- | --- | --- |
| Receive texts from any phone, any country | yes | yes |
| Send to other US Telnyx numbers | yes | yes |
| Send to ordinary US mobiles (including the PONG reply) | blocked by carriers | yes |
| Send to numbers outside the US | never (US destinations only) | never |
| Signature check, delivery receipts, your code | yes | yes |

## Environment variables

| Variable | Set by | Used for |
| --- | --- | --- |
| `TELNYX_API_KEY` | the integration | Scoped Telnyx token for this number: send and read messages only. Keep it server-side. |
| `TELNYX_PHONE_NUMBER` | the integration, after the identity check | The `from` number, E.164 |
| `TELNYX_MESSAGING_PROFILE_ID` | the integration | The messaging profile the number belongs to |
| `TELNYX_MESSAGING_WEBHOOK_URL` | the integration | Where inbound texts and delivery receipts go (`/api/telnyx/inbound` of the connected project) |
| `TELNYX_PUBLIC_KEY` | the integration | Ed25519 key for verifying webhook signatures |
| `TELNYX_ACCOUNT_ID` | the integration | Your Telnyx account id; quote it to support |
| `SEND_FORM_PASSWORD` | you | Protects `/api/send`. Sending is off while it is unset. |

Variables added or changed after a deployment take effect on the next deployment.

## The two routes

- `app/api/send/route.ts`: `POST { to, text, password }` sends an SMS with `POST /v2/messages`. It refuses requests without the right `SEND_FORM_PASSWORD` (fails closed when unset), accepts US numbers in E.164 only, and returns Telnyx's error detail when a send is refused. Replace the password with your own auth before you build on it.
- `app/api/telnyx/inbound/route.ts`: receives Telnyx events. It verifies the Ed25519 signature over `${telnyx-timestamp}|${body}` (five-minute tolerance) and **fails closed** with 401 when the key, headers or signature are wrong; dedupes on `data.id` (retries and failover can deliver an event twice; the in-memory dedupe is best effort); logs inbound texts and delivery receipts; and answers within 2 seconds. The PING reply is awaited so Vercel does not stop the function before it is sent. Replace it with your own handling.

## Troubleshooting

- **Home page says "No Telnyx number yet"**: the project has no `TELNYX_*` variables. Connect the Telnyx resource to the project in Vercel, then redeploy.
- **"Waiting for your number"**: the identity check is not accepted yet. Open Telnyx from the integration in Vercel; redeploy once the number is assigned.
- **Inbound route answers 401**: `TELNYX_PUBLIC_KEY` is missing from this deployment (redeploy after connecting), or the request did not come from Telnyx.
- **A send to a US mobile fails**: expected until your 10DLC campaign is approved (see above).
- **Error "US destinations only"**: the number you entered is not a US number.

## Local development

```sh
vercel link && vercel env pull .env.local   # or: cp .env.example .env.local and fill it in
npm install
npm run dev
```

Inbound webhooks need a public URL to reach your laptop (a tunnel such as `ngrok http 3000`); set it as the inbound webhook on the number in Vercel while you test, and set it back afterwards.

## Support

Email [support@telnyx.com](mailto:support@telnyx.com) with your `TELNYX_ACCOUNT_ID`, or use **Support** on the Telnyx resource in Vercel.
