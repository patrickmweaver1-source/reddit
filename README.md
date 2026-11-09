# Free SMS Inbox Finder

A single-page, static web app that:

- Lists free, public, no-signup SMS-receiving sites (Quackr, SMS24.me, Receive-SMSS, GetFreeSMSNumber, FreePhoneNum) with country coverage and notes.
- Filters by country / search, and lets you keep your own 👍/👎 "worked for me" tally (stored in your browser only).
- Has a "Will a free number work?" checker that tells you whether a target service usually accepts shared VoIP numbers (e.g. Reddit/Google: often/maybe; WhatsApp, banks, PayPal: usually blocked).

No backend, no scraping, no build step. Open `index.html` or deploy the folder to any static host (Netlify, GitHub Pages, Vercel).

To add a provider or service, edit the `PROVIDERS` / `SERVICES` arrays at the top of the `<script>` in `index.html`.

**Note:** public inboxes are readable by anyone and numbers get reused, so never use them for accounts you care about.
