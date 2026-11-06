---
name: telnyx-vercel-sms
description: Add a Telnyx US SMS phone number to a Vercel project through the Vercel Marketplace and wire up sending and receiving texts. Use when someone wants to send or receive SMS from a Vercel or Next.js app, mentions Telnyx on Vercel, the Vercel integration `telnyx` or `telnyx/phone-number`, the TELNYX_* environment variables, or Telnyx webhooks, 10DLC or SMS delivery errors in a Vercel project.
---

# Telnyx SMS on Vercel

The Telnyx integration on the Vercel Marketplace (slug `telnyx`, product `telnyx/phone-number`, shown as *SMS Phone Number (US)*) gives a Vercel project a US phone number that can send and receive SMS. Installing it creates a Telnyx account for the Vercel team. Billing is prepaid credit bought in Vercel.

Full guide for humans: https://telnyx-vercel-integration.vercel.app/docs
Working example app: https://github.com/team-telnyx/telnyx-vercel-sms-template

## Know this before you start

- **US only.** US local numbers, and they can only text US numbers. No voice, MMS or toll-free.
- **Prepaid.** Credit is bought in Vercel, from $10. The number is $1 a month; texts and 10DLC fees come out of the same balance.
- **A person has to do two things.** Accept the terms and pay for credit in Vercel, then pass a one-time identity check (government photo ID and a selfie). You cannot do either for them. Tell the user when it is their turn and wait.
- **Texting US mobile phones needs 10DLC registration**, which takes about a week. Until then, sends to ordinary US mobiles fail. Receiving texts and texting other Telnyx numbers work straight away.
- **One Telnyx account per email address.** Each install creates a new Telnyx account under the Vercel team's email. If that address already has a Telnyx account, the integration retries with a plus-address of the same mailbox (`name+vercel-…@company.com`). Free email providers (Gmail, Outlook, Yahoo, iCloud and others) treat that as the same address, so for them the install stops. Linking an existing Telnyx account isn't supported yet.

## 1. Find and install with the Vercel CLI

Use a current CLI (`npm i -g vercel@latest`), signed in (`vercel login`), and run everything from the app's directory.

```sh
vercel link --yes                                # or: vercel link --yes --project <name> --scope <team>
vercel integration discover telnyx --format=json  # shows the product slug telnyx/phone-number
vercel integration add telnyx/phone-number --help # shows the plan and the metadata keys
vercel integration guide telnyx --framework nextjs
```

Install the product, connected to the linked project:

```sh
vercel integration add telnyx/phone-number --billing-plan telnyx-prepaid
```

Optional metadata, each as `--meta KEY=VALUE`:

| Key | What it does |
| --- | --- |
| `area_code` | A 3-digit US area code, like `415`. Leave it out to get any US number. |
| `webhook_url` | Your own https URL for incoming texts. Leave it out and the integration uses the connected project (see step 3). |
| `webhook_failover_url` | An https URL Telnyx tries if the main one fails. |

CLI 55 and older call these flags `--plan` and `-m`. Newer CLIs still accept those as deprecated aliases. Check `vercel integration add telnyx/phone-number --help` if a flag is refused.

The first install on a team needs a person in the browser, to accept the Telnyx terms and to buy credit (at least $10). The CLI can't do either:

- In an agent or other non-interactive shell, the CLI doesn't wait. It exits with `"status": "action_required"`, a `verification_uri` and a `next` command. Give the user the URL, wait until they say it's done, then run the `next` command.
- In an interactive terminal the user accepts the terms at the prompt, or in the browser the CLI opens (it waits up to 5 minutes). If credit still has to be bought, the CLI opens the setup page, prints "Additional setup required" and exits.
- Either way, confirm the resource exists afterwards with `vercel integration list --integration telnyx`. Then connect it (step 3) if it isn't connected, and run `vercel env pull`.

When the CLI provisions the resource itself, it also connects it to the linked project and runs `vercel env pull`. Pass `--no-connect` to skip both. Use `-e production -e preview` to connect only some environments; the default is all three.

## 2. The identity check (the user does this)

Telnyx assigns the phone number only after a one-time identity check. Ask the user to open the Telnyx dashboard:

```sh
vercel integration open telnyx          # add --json to print the sign-in link instead of opening a browser
```

There, a Vercel team admin selects **Start identity check** and follows the steps (photo of an ID, then a selfie, about 3 minutes). Most checks pass within minutes; a manual review can take up to 24 hours. When it passes, Telnyx assigns the number and adds `TELNYX_PHONE_NUMBER` to the resource, usually within a minute.

Check progress without the dashboard:

```sh
vercel integration list --integration telnyx       # find the resource name
vercel integration resource inspect <resource-name>
vercel env pull .env.local && grep -c TELNYX_PHONE_NUMBER .env.local   # 1 once the number is assigned
```

## 3. Connect a project and redeploy

If the resource isn't connected to the project yet (or you used `--no-connect`):

```sh
vercel integration resource connect <resource-name> [project] --yes
```

When a project is connected and no `webhook_url` was set, the integration points incoming texts at `https://<production domain>/api/telnyx/inbound` and sets `TELNYX_MESSAGING_WEBHOOK_URL`. So the inbound route must live at exactly `app/api/telnyx/inbound/route.ts` and must be deployed to production.

Environment variables only reach a deployment built after they were added. Redeploy after connecting, and again after the number is assigned:

```sh
vercel deploy --prod
```

## 4. Pull the variables for local work

```sh
vercel env pull .env.local
```

This pulls the Development environment. If you connected only some environments, add `--environment production` (or `preview`).

| Variable | What it is |
| --- | --- |
| `TELNYX_API_KEY` | A Telnyx API key that can only send and read messages. Server-side only, never expose it to the browser. |
| `TELNYX_PHONE_NUMBER` | The number to send from, in E.164 (`+1...`). Only present after the identity check. |
| `TELNYX_MESSAGING_PROFILE_ID` | The messaging profile the number belongs to. Arrives with the number. |
| `TELNYX_MESSAGING_WEBHOOK_URL` | Where Telnyx sends incoming texts and delivery receipts. Present once the number is assigned and a webhook is set (your `webhook_url`, or a connected project). |
| `TELNYX_PUBLIC_KEY` | Base64 Ed25519 public key for checking webhook signatures. Can arrive with the number rather than at install. |

Before the identity check passes, expect only `TELNYX_API_KEY`, and maybe `TELNYX_PUBLIC_KEY`. Don't rename these or commit `.env.local`.

## 5. Send a text

From a terminal, after `vercel env pull` (load the file first, for example `set -a; . ./.env.local; set +a`):

```sh
curl -X POST https://api.telnyx.com/v2/messages \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"from\":\"$TELNYX_PHONE_NUMBER\",\"to\":\"+14155550123\",\"text\":\"Hello from Vercel\"}"
```

From Next.js, add a route handler. See [references/nextjs.md](references/nextjs.md) for the full `app/api/send/route.ts`, with and without the `telnyx` npm package. Rules:

- Put your own auth in front of the send route. Anyone who can call it can spend the user's balance. The samples check a `SEND_API_SECRET` bearer token as a placeholder and refuse everything while it is unset.
- `to` must be a US number in E.164, like `+14155550123`.
- A 200 response means Telnyx queued the message, not that it was delivered. Keep `data.id` to check later.

## 6. Receive texts and verify webhooks

Telnyx POSTs JSON to `/api/telnyx/inbound` for incoming texts (`message.received`) and for delivery receipts on your sends (`message.sent`, then `message.finalized`). Every request is signed:

- Header `telnyx-signature-ed25519`: base64 Ed25519 signature.
- Header `telnyx-timestamp`: Unix seconds.
- Signed bytes: `${timestamp}|${rawBody}`, checked with `TELNYX_PUBLIC_KEY`.

The handler must:

1. Read the raw body with `await req.text()` before parsing. Verifying re-serialised JSON fails.
2. Reject a bad or missing signature, or a timestamp more than 5 minutes off, with 401.
3. Answer 2xx within 2 seconds. Otherwise Telnyx retries and then tries the failover URL.
4. Skip events whose `data.id` it has already handled. Retries can deliver an event twice.
5. `await` any reply it sends before returning. Vercel stops the function once the response is sent.

The full verified handler is in [references/nextjs.md](references/nextjs.md). The incoming text is `data.payload.text` and the sender is `data.payload.from.phone_number`.

If the production deployment sits behind Vercel Deployment Protection, Telnyx can't reach the route. The production domain has to be public.

## 7. Check that it works

1. **Receive.** Ask the user to text the number from any phone, in any country. Then look for the request:
   ```sh
   vercel logs --environment production --since 30m
   ```
   A 200 on `/api/telnyx/inbound` means delivery and signature checks work. A 401 means the signature check failed (see errors below).
2. **Send.** Send to a US number. Before 10DLC approval, only other Telnyx numbers receive it; a US mobile won't.
3. **Check delivery** with the message id from the send response:
   ```sh
   curl https://api.telnyx.com/v2/messages/MESSAGE_ID \
     -H "Authorization: Bearer $TELNYX_API_KEY"
   ```
   `data.to[0].status` moves through `queued`, `sending`, `sent` to `delivered`. `sending_failed` or `delivery_failed` come with a code in `data.errors`. The same status arrives as `message.finalized` on the webhook.
4. **Balance**: `vercel integration balance telnyx`. When no auto-recharge threshold is set, the CLI can fail here with `TypeError: Cannot read properties of undefined` (seen on CLI 55 and 65). Then read the balance on the resource in Vercel, or in the Telnyx dashboard (`vercel integration open telnyx`).

## 8. 10DLC registration (to text US mobile phones)

US carriers only deliver texts from registered business numbers. The user registers in the Telnyx dashboard (`vercel integration open telnyx`, then **Messaging**):

1. Register the brand: legal company name, EIN, address, website. $4.50 once, usually minutes.
2. Submit a campaign: use case, sample messages, how people opt in, opt-out and help replies. The monthly fee is shown before submitting.
3. Telnyx reviews it, usually in 1 to 3 business days (free). Then the carriers review it, about 3 more business days, and the campaign fee is charged.
4. Once approved, the number is added to the campaign automatically and can text US mobiles within minutes.

You can't register for the user, and code changes don't speed it up. Most rejections are about the website and the opt-in wording. Build and test with inbound texts and Telnyx-to-Telnyx sends while waiting.

## Common errors

| What you see | Cause | Fix |
| --- | --- | --- |
| `TELNYX_*` variables missing in the app | Resource not connected, or the deployment predates them | `vercel integration resource connect <resource-name> --yes`, then `vercel deploy --prod`. Locally, `vercel env pull .env.local` again. |
| Only `TELNYX_API_KEY` (and maybe `TELNYX_PUBLIC_KEY`) present | Identity check not passed yet | User completes it via `vercel integration open telnyx`, then redeploy. |
| Send accepted, then `message.finalized` or the status check shows code **40010** (Not 10DLC registered) | Sending to a US mobile before the 10DLC campaign is approved | Expected until approval. See 10DLC above. |
| Send refused with **40309** (Invalid destination region) or **40306** (Alpha sender not configured) | Destination is outside the US | Only US numbers can be texted. Validate `to` as `+1` and 10 digits before sending. |
| HTTP **403** from the Telnyx API | The key only allows sending and reading messages. Numbers, profiles, billing and other endpoints are refused | Use the API only for `/v2/messages`. Manage everything else in the Telnyx dashboard or in Vercel. |
| HTTP **401** from the Telnyx API | Wrong or missing `TELNYX_API_KEY`, or a key that was rotated more than 24 hours ago | Redeploy to pick up the current key. Rotating the key (dashboard, team admins) pushes the new key to connected projects. |
| `/api/telnyx/inbound` answers 401 | `TELNYX_PUBLIC_KEY` missing from this deployment, body parsed before verifying, or the request isn't from Telnyx | Redeploy after connecting. Verify against the raw `req.text()` body. |
| No inbound requests at all | Route not at `app/api/telnyx/inbound`, not deployed to production, production protected, or a custom `webhook_url` points elsewhere | Check `TELNYX_MESSAGING_WEBHOOK_URL` (after `vercel env pull`) and deploy the route to production. |
| Install stops: "There's already a Telnyx account for …" | The team email (a free email provider, so no plus-address) already has a Telnyx account | A known limitation. Linking an existing Telnyx account isn't supported yet. |
| Sends stop working | Prepaid balance reached $0 | Add funds or set auto-recharge on the resource in Vercel. |
| `connect` fails with a variable name conflict | The project already has a variable with the same name | Remove the old one with `vercel env rm`, or connect with `--prefix`, and update the code to match. |

## Limits

- US local numbers only, sending to US numbers only. No voice, MMS, toll-free or short codes.
- One prepaid balance per installation, shared by all its numbers. Refunds of unused credit go through `support@telnyx.com`.
- The API key can only send and read messages.
- The inbound webhook is per installation, not per project. It points at the first project connected without a custom `webhook_url`.
- Deleting the resource releases the number for good. Uninstalling closes the Telnyx account.

Support: open Telnyx from the integration in Vercel, go to **Support**, select **Copy support details** and email `support@telnyx.com`. 10DLC questions: `10dlcquestions@telnyx.com`.
