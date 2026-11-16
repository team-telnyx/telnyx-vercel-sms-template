# Telnyx SMS on Vercel

A small Next.js app for a Telnyx phone number bought through the [Vercel Marketplace](https://vercel.com/marketplace/telnyx). Deploy it, verify your identity, and text your number: the message shows up on the home page in a second, and you can text your phone back from the page. It receives texts and delivery receipts on a signed webhook and replies **PONG** to **PING**.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fteam-telnyx%2Ftelnyx-vercel-sms-template&project-name=telnyx-vercel-sms-template&repository-name=telnyx-vercel-sms-template&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22telnyx%22%2C%22productSlug%22%3A%22phone-number%22%2C%22protocol%22%3A%22other%22%7D%5D)

The button clones this repo and adds the Telnyx *SMS Phone Number (US)* product to the new project. There's nothing else to fill in.

The full setup guide, including costs, 10DLC registration, support and uninstalling, is at [vercel.telnyx.com/docs](https://vercel.telnyx.com/docs).

## Set it up with a coding agent

This repo has an agent skill, [`skills/telnyx-vercel-sms`](skills/telnyx-vercel-sms/SKILL.md), that covers installing with the Vercel CLI, the environment variables, sending, receiving, 10DLC and common errors. Install it into your project with:

```sh
npx skills add team-telnyx/telnyx-vercel-sms-template --skill telnyx-vercel-sms
```

Then paste this prompt into your coding agent:

```text
Add a Telnyx US SMS number to this project using the Vercel CLI.

1. Use the telnyx-vercel-sms skill. If it isn't installed, run
   `npx skills add team-telnyx/telnyx-vercel-sms-template --skill telnyx-vercel-sms`
   or read https://github.com/team-telnyx/telnyx-vercel-sms-template/blob/main/skills/telnyx-vercel-sms/SKILL.md
2. Find the integration with `vercel integration discover telnyx` and check the
   plan and options with `vercel integration add telnyx/phone-number --help`.
3. Link this directory with `vercel link`, then run
   `vercel integration add telnyx/phone-number --billing-plan telnyx-prepaid`.
   If the CLI stops with a link to accept terms or add credit, give me the link,
   wait for me, then run the next command it suggests.
4. Ask me to complete the identity check (`vercel integration open telnyx`) and wait
   until TELNYX_PHONE_NUMBER is set.
5. Make sure the number is connected to this project, run `vercel env pull .env.local`,
   and read `vercel integration guide telnyx --framework nextjs`.
6. Add a send route protected by auth, and a signed inbound route at
   app/api/telnyx/inbound, as the skill describes. Deploy to production, then help me
   check that sending and receiving work.
```

The agent can't accept the terms, pay or do the identity check for you. It will stop and ask when it's your turn.

## Before you start

- **US only.** Numbers are US local numbers, and they can only send to US numbers.
- **Prepaid balance.** You add funds in Vercel, starting at $10. Your prepaid balance pays for the number ($1.00 to activate, then $1.10 a month including SMS, with the first month prorated), for messages, and for US messaging registration fees, all at public Telnyx rates. For a refund, contact Telnyx support.
- **Identity check.** Telnyx creates an account for your Vercel team. Before Telnyx assigns a phone number, a Vercel team admin completes a one-time identity check with a government photo ID and a selfie. Onfido runs the check for Telnyx. Most checks finish within a few minutes, and some take up to 24 hours.
- **US messaging registration.** Texts to US mobile phones need a registered brand and campaign (10DLC). Receiving texts works straight away. See [Costs and timing](https://vercel.telnyx.com/docs).

## Run it

1. Select **Deploy**. Add Telnyx on the *Pay as you go* plan and add funds.
2. Open the deployed site and select **Open Telnyx** to complete the identity check. When it passes, Vercel adds your number to the project.
3. Redeploy the project from the **Deployments** tab so it picks up the new variables.
4. Scan the QR code or tap **Open Messages**, and send the text. It appears on the page, and the app replies PONG.

To text US mobile phones, select **Register for US messaging** on the page. Until your campaign is approved, the page shows replies as held by the carrier.

To add Telnyx to an existing project, add it from the Marketplace and connect the phone number to your project. Then copy `app/api/telnyx/inbound/route.ts` and `lib/telnyx.ts` into your app.

## How sending is protected

The send form has no password, and it's still safe on a public URL:

- **It only texts a phone that texted first.** The page shows a one-time code (`PING 4F7K`). When a phone texts that code to your number, the webhook links the phone to that browser. The send route reads the recipient from the browser's session, never from the request, so a visitor can only text their own phone.
- **Limits.** 3 texts per phone per 10 minutes, 25 texts per day per deployment (`DAILY_SEND_LIMIT` changes it), 160 characters each. They're in `lib/limits.ts`.
- **STOP is honoured.** Telnyx handles STOP, START and HELP on your messaging profile and sends the confirmation. The app never replies to them, and it won't text a phone that opted out.
- **Message text stays private.** Anyone with the link sees that a text arrived, with the number masked to its last 4 digits. Only the browser linked to a phone sees that phone's messages.

To text any US number from the page, set `SEND_FORM_PASSWORD` on the project and redeploy. A **Send to any US number** section appears that asks for it.

## Where messages are kept

In [Vercel Runtime Cache](https://vercel.com/docs/runtime-cache), with no setup. Messages, delivery statuses and sessions expire after 24 hours, and the cache can drop them sooner. Each environment has its own cache, so a preview deployment doesn't see texts sent to production. On the Hobby plan, the cache and its monthly read and write allowance are shared by every project in your team. One open tab makes about 600 reads in 15 minutes, then stops polling until you select **Resume**.

### Keep messages for real

Everything that touches the cache is in `lib/store.ts`. Swap it for a database, or for Redis from the Vercel Marketplace, to keep messages for good. Redis's atomic list and counter commands also remove the small chance that two messages arriving at the same moment drop one from the feed.

## Environment variables

| Variable | Set by | Used for |
| --- | --- | --- |
| `TELNYX_API_KEY` | The integration, as soon as you add the number | A Telnyx key for this number that can only send and read messages. Keep it on the server. |
| `TELNYX_PHONE_NUMBER` | The integration, after the identity check | The number you send from, in E.164 format |
| `TELNYX_MESSAGING_PROFILE_ID` | The integration, after the identity check | The messaging profile the number belongs to |
| `TELNYX_MESSAGING_WEBHOOK_URL` | The integration, after the identity check, once the number is connected to a project or you set an inbound webhook URL on it | Where incoming texts and delivery receipts go. When you connect a project, it's that project's `/api/telnyx/inbound` route. |
| `TELNYX_PUBLIC_KEY` | The integration, after the identity check (it can take up to an hour after the number arrives) | The Ed25519 key that verifies webhook signatures |
| `TELNYX_DASHBOARD_URL` | The integration | Opens your Telnyx dashboard through Vercel sign-in, for the **Open Telnyx** and **Register for US messaging** buttons. Without it, they open the Telnyx integration page in Vercel. |
| `SEND_FORM_PASSWORD` | You, optional | Turns on **Send to any US number** on the home page |
| `DAILY_SEND_LIMIT` | You, optional | Texts per day the page may send. Defaults to 25. |

Before the identity check passes, only `TELNYX_API_KEY` is set. Variables added or changed after a deployment take effect on the next deployment.

## Routes

- `app/api/telnyx/inbound/route.ts` receives Telnyx events. It verifies the Ed25519 signature over `${telnyx-timestamp}|${body}` with a five-minute tolerance, and answers 401 when the key, headers or signature are wrong. It skips events it has already seen by `data.id`, because retries and the failover URL can deliver an event twice. It replies PONG to PING and waits for that reply to send before it returns, so Vercel doesn't stop the function early. Everything else (the feed, pairing, delivery statuses) runs after the response, so it answers well within Telnyx's 2 seconds.
- `app/api/send/route.ts` takes `POST { text }` and texts the phone linked to this browser, or `POST { to, text, password }` when `SEND_FORM_PASSWORD` is set. It sends with the `telnyx` SDK (`client.messages.send`) and returns Telnyx's error detail when a send fails.
- `app/api/session/route.ts` gives this browser its pairing code, its Messages link and its QR code.
- `app/api/feed/route.ts` returns the live feed for the home page. When a delivery receipt is late, it asks Telnyx for the status once.

## Troubleshooting

- **The home page says "Add Telnyx to this project".** The project has no `TELNYX_*` variables. Connect the Telnyx phone number to the project in Vercel, then redeploy.
- **The home page says "Verify your identity to get your number".** The identity check hasn't passed yet. Redeploy once the number is assigned.
- **The page doesn't update when you text.** Check that you're on the production domain: preview deployments don't receive texts. Redeploy if the deployment is older than connecting the number. On Pro with several function regions, the webhook and the page can land in different regions. On Hobby, the Runtime Cache pauses when the team's monthly allowance runs out. Your function logs for `/api/telnyx/inbound` show every text either way.
- **The inbound route answers 401.** Either `TELNYX_PUBLIC_KEY` is missing from this deployment, or the request didn't come from Telnyx. Redeploy after you connect the number.
- **A text to a US mobile phone is "held by the carrier".** This is expected until your campaign is approved. Select **Register for US messaging**.
- **Your phone isn't a US number.** You can text the page from any country, but it can only text US numbers back.

## Local development

```sh
vercel link && vercel env pull .env.local   # or: cp .env.example .env.local and fill it in
npm install
npm run dev
npm test
```

Incoming webhooks need a public URL to reach your computer, such as a tunnel from `ngrok http 3000`. Set that URL as the inbound webhook on the phone number in Vercel while you test, and change it back when you're done.

## Support

Open **Telnyx** from the integration page in Vercel and go to **Support**. Select **Copy support details** and paste them into an email to [support@telnyx.com](mailto:support@telnyx.com).
