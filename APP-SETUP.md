# Albibi Office Assistant

A private web app at **`/app/`** for anyone with an **@albibiconstruction.com** email. Workers describe a job however they like, in any order, typed or spoken ("invoice for Mike at 45 Oak Ave, tore out the deck for 850, 3 days carpentry at 600 a day, lumber was 4,235.50, due in 15 days"). The assistant builds the invoice, estimate or bill as they talk, and a professional PDF comes out the other end. They can then **share** it (text/Messages/WhatsApp on phones), **email** it to the customer, or download it.

## How it works

| Piece | What it does |
| --- | --- |
| Sign in | A worker enters the first part of their email (`john.smith`). A 6-digit code goes to `john.smith@albibiconstruction.com`. The code expires after 10 minutes, works once, and allows 5 wrong tries. A worker can ask for at most 5 codes every 15 minutes. After signing in they stay signed in for 30 days (a signed, HttpOnly cookie). |
| Assistant | `netlify/lib/assistant.mjs` sends the conversation and the current document to Claude and gets back structured JSON. Claude never invents prices. It asks when something is missing. Totals are always worked out in code, never by the AI. |
| PDF | `netlify/lib/pdf.mjs` makes a Letter-size PDF with a letterhead, bill-to and job-site blocks, line items, discount, tax, deposit/balance due, notes and terms. Estimates also get a customer signature line. Long documents run onto more pages. |
| Numbers & history | Each document gets the next number (`INV-2026-0001`, `EST-…`, `BILL-…`) when its first PDF is made. It is saved in Netlify Blobs, so anyone on the team can reopen it from **History**, change it by chatting, and resend it. |
| Email | Sent through [Resend](https://resend.com) with the PDF attached. Customer replies go to the worker who sent it. |

Code layout: `source/app/` (web page) is copied to `theme/app/` by `gulp build`. `netlify/functions/` holds the API endpoints and `netlify/lib/` the shared logic.

## Setup (one time)

1. **Claude API key.** Create one at <https://console.anthropic.com>.
2. **Email.** Sign up at <https://resend.com>, add and verify the domain `albibiconstruction.com` (it gives you a few DNS records to add), then create an API key.
3. **Netlify.** Open *Site configuration → Environment variables* and add:

   | Variable | Value |
   | --- | --- |
   | `SESSION_SECRET` | a long random string, e.g. the output of `openssl rand -hex 32` |
   | `ANTHROPIC_API_KEY` | from step 1 |
   | `RESEND_API_KEY` | from step 2 |
   | `EMAIL_FROM` | `Albibi Construction <no-reply@albibiconstruction.com>` |
   | `COMPANY_ADDRESS`, `COMPANY_PHONE`, `COMPANY_EMAIL`, `COMPANY_LICENSE` | printed on every PDF |
   | `DEFAULT_TAX_RATE` | e.g. `6.25` (optional) |

   `.env.example` lists every option.
4. **Deploy** (push to the branch Netlify builds). The app is then at `https://<your-site>/app/`.

> **Timeouts:** Netlify functions stop after 10 seconds by default. A long first message can take longer than that. If workers see "Something went wrong" on big messages, ask Netlify support to raise the function timeout to 26 seconds, or set `ANTHROPIC_MODEL=claude-sonnet-5-5` for faster replies.

## Run it on your computer

```bash
npm install
cp .env.example .env        # fill in SESSION_SECRET and ANTHROPIC_API_KEY, set ALLOW_DEV_LOGIN=true
npm run app:dev             # http://localhost:8888/app/
npm test
```

With `ALLOW_DEV_LOGIN=true` and no `RESEND_API_KEY`, sign-in codes and emails are printed in the terminal instead of being sent. Never turn this on for the live site.
