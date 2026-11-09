# Free SMS Inbox Finder

A single-page, static web app that:

- Lists free, public, no-signup SMS-receiving sites (Quackr, SMS24.me, Receive-SMSS, GetFreeSMSNumber, FreePhoneNum) with country coverage and notes.
- Filters by country / search, and lets you keep your own 👍/👎 "worked for me" tally (stored in your browser only).
- Has a "Will a free number work?" checker that tells you whether a target service usually accepts shared VoIP numbers (e.g. Reddit/Google: often/maybe; WhatsApp, banks, PayPal: usually blocked).

- **Live inbox:** pick a country and number, see the latest texts, click a highlighted code to copy it. Powered by `netlify/functions/inbox.js`, which reads FreePhoneNum.com only (a fixed host — it is not an open proxy). Quackr, SMS24.me, Receive-SMSS and GetFreeSMSNumber block automated reading (Cloudflare challenge / client-side loading), so they stay link-only.

## Deploy
Push to a Netlify site (config is in `netlify.toml`, no build step), or run locally with `npx netlify dev`. Opening `index.html` directly works, but the live inbox needs the function, so it won't load that way.

If FreePhoneNum changes its page layout, update the regexes in `parseNumbers` / `parseMessages`.

To add a provider or service, edit the `PROVIDERS` / `SERVICES` arrays at the top of the `<script>` in `index.html`.

**Note:** public inboxes are readable by anyone and numbers get reused, so never use them for accounts you care about.
