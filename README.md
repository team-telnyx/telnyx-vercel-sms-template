# Telnyx SMS on Vercel

A small Next.js app for a Telnyx phone number bought through the [Vercel Marketplace](https://vercel.com/marketplace/telnyx). It sends SMS from a password-protected form, receives incoming texts and delivery receipts on a signed webhook, and replies **PONG** to **PING**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fteam-telnyx%2Ftelnyx-vercel-sms-template&project-name=telnyx-sms&repository-name=telnyx-sms&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22telnyx%22%2C%22productSlug%22%3A%22phone-number%22%2C%22protocol%22%3A%22storage%22%7D%5D&env=SEND_FORM_PASSWORD&envDescription=Choose%20a%20password%20for%20the%20send%20form.%20It%20stops%20strangers%20from%20sending%20texts%20on%20your%20Telnyx%20balance.&envLink=https%3A%2F%2Fgithub.com%2Fteam-telnyx%2Ftelnyx-vercel-sms-template%23environment-variables)

The button clones this repo, asks you to choose a `SEND_FORM_PASSWORD`, and adds the Telnyx *SMS Phone Number (US)* product to the new project.

## Before you start

- **US only.** Numbers are US local numbers, and they can only send to US numbers.
- **Prepaid balance.** You add funds in Vercel, starting at $10. Your prepaid balance pays for the number at $1 a month, for messages, and for US messaging registration fees, all at public Telnyx rates. For a refund, contact Telnyx support.
- **Identity check.** Telnyx creates an account for your Vercel team. Before Telnyx assigns a phone number, the account owner completes a one-time identity check with a government photo ID and a selfie. Onfido runs the check for Telnyx. Most checks finish within a few minutes, and some take up to 24 hours. To start it, open **Telnyx** from the integration page in Vercel.
- **US messaging registration.** Texts to US mobile phones need a registered brand and campaign. See [What works before registration](#what-works-before-registration).

## Run it

1. Select **Deploy**. Choose a password for the send form, add Telnyx on the *Pay as you go* plan, and add funds.
2. Open **Telnyx** from the integration page in Vercel and complete the identity check. When it passes, Telnyx assigns your phone number and Vercel adds `TELNYX_PHONE_NUMBER` to the project.
3. Redeploy the project from the **Deployments** tab so it picks up the new variables. The home page then shows your number.
4. Text **PING** to your number from any phone. The message appears in your project's logs for `/api/telnyx/inbound`. Connecting the number to the project sets its inbound webhook to `https://<production-domain>/api/telnyx/inbound` automatically.
5. Send a message to a US number from the form on the home page, using your password.
6. To text US mobile phones, register your brand and campaign on the **Messaging** page of the Telnyx dashboard.

To add Telnyx to an existing project, add it from the Marketplace and connect the phone number to your project. Then copy `app/api/telnyx/inbound/route.ts` and `lib/telnyx.ts` into your app.

## What works before registration

US carriers only deliver texts from registered business numbers. This registration is called 10DLC. To register, open **Telnyx** from the integration page in Vercel and go to **Messaging**. You register your brand once for a one-time $4.50 fee, then submit a campaign that describes your messages.

- Telnyx reviews the campaign first, usually in 1 to 3 business days. This review is free.
- Telnyx then sends the campaign to the carriers and charges the campaign fee. The fee is shown before you submit and is paid from your prepaid balance.
- Carrier review takes about 3 business days, or 72 business hours.
- Your number is added to the campaign automatically and can text US mobile phones within minutes of approval.

| | Before approval | After approval |
| --- | --- | --- |
| Receive texts from any phone in any country | Yes | Yes |
| Send to other US Telnyx numbers | Yes | Yes |
| Send to US mobile phones, including the PONG reply | Blocked by carriers | Yes |
| Send to numbers outside the US | No | No |
| Signature checks and delivery receipts | Yes | Yes |

## Environment variables

| Variable | Set by | Used for |
| --- | --- | --- |
| `TELNYX_API_KEY` | The integration | A Telnyx key for this number that can only send and read messages. Keep it on the server. |
| `TELNYX_PHONE_NUMBER` | The integration, after the identity check | The number you send from, in E.164 format |
| `TELNYX_MESSAGING_PROFILE_ID` | The integration | The messaging profile the number belongs to |
| `TELNYX_MESSAGING_WEBHOOK_URL` | The integration | Where incoming texts and delivery receipts go, the `/api/telnyx/inbound` route of the connected project |
| `TELNYX_PUBLIC_KEY` | The integration | The Ed25519 key that verifies webhook signatures |
| `SEND_FORM_PASSWORD` | You | Protects `/api/send`. Sending is off until you set it. |

Variables added or changed after a deployment take effect on the next deployment.

## The two routes

- `app/api/send/route.ts` takes `POST { to, text, password }` and sends an SMS with `POST /v2/messages`. It refuses requests without the right `SEND_FORM_PASSWORD`, and refuses all requests while the password is unset. It only accepts US numbers in E.164 format, and it returns Telnyx's error detail when a send fails. Replace the password with your own authentication before you build on it.
- `app/api/telnyx/inbound/route.ts` receives Telnyx events. It verifies the Ed25519 signature over `${telnyx-timestamp}|${body}` with a five-minute tolerance, and answers 401 when the key, headers or signature are wrong. It skips events it has already seen by `data.id`, because retries and the failover URL can deliver an event twice. The check is in memory, so it can miss a duplicate. The route logs incoming texts and delivery receipts and answers within 2 seconds. It waits for the PING reply to send before it returns, so Vercel doesn't stop the function early. Replace it with your own handling.

## Troubleshooting

- **The home page says "No Telnyx phone number yet".** The project has no `TELNYX_*` variables. Connect the Telnyx phone number to the project in Vercel, then redeploy.
- **The home page says "Waiting for your phone number".** The identity check hasn't passed yet. Open Telnyx from the integration page in Vercel to check it. Redeploy once the number is assigned.
- **The inbound route answers 401.** Either `TELNYX_PUBLIC_KEY` is missing from this deployment, or the request didn't come from Telnyx. Redeploy after you connect the number.
- **A send to a US mobile phone fails.** This is expected until your campaign is approved. See [What works before registration](#what-works-before-registration).
- **The form says the number must be a US number.** This integration only sends to US numbers.

## Local development

```sh
vercel link && vercel env pull .env.local   # or: cp .env.example .env.local and fill it in
npm install
npm run dev
```

Incoming webhooks need a public URL to reach your computer, such as a tunnel from `ngrok http 3000`. Set that URL as the inbound webhook on the phone number in Vercel while you test, and change it back when you're done.

## Support

Open **Telnyx** from the integration page in Vercel and go to **Support**. Select **Copy support details** and paste them into an email to [support@telnyx.com](mailto:support@telnyx.com).
