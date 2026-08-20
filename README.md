# VsimplifAI — Lead Engine

A real, runnable, deployable consent-first lead app for real estate agents (post-Bloctel / loi 2025-594). Zero npm dependencies — just Node.js.

## The two surfaces
- **`/capture`** — the public page a *prospect* sees (QR / LinkedIn / ad link points here). They request an estimate; the double opt-in captures their consent.
- **`/`** — the *agent* dashboard: today's ranked leads, AI posts, who consented, pricing, and a one-click consent-register **CSV export** (`/api/export.csv`).
- **`/login`** — agent signup (Stripe) + login.

## Deploy
- `package.json` has `start: node server.js`; `Procfile` and `render.yaml` are included.
- Recommended: **Render**, region **Frankfurt (EU)**. New + → Blueprint → pick the repo → it reads `render.yaml` → add the secret values.

## Run it

```bash
cd mvp-app
node server.js
```

Then open **http://localhost:3000** in your browser.

## What works (the core loop, live)

1. **Mes leads du jour** — the server scores real property data (`data/properties.json`) by "propensity to list" and ranks it. Scoring lives in `lib/score.js`.
2. **Capture (démo)** — submit the form → a lead is created with `consent_status: pending` and a confirmation is "sent" (logged to the console; in production Brevo sends the email + SMS).
3. **Qui a consenti** — see the lead. Click **Simuler OUI** to confirm consent → it's logged with a timestamp and becomes **callable**. This is the double opt-in, working.

All data persists in `data/leads.json` (the "Memory" / consent log).

## File map

| File | Role (the four layers) |
|------|------------------------|
| `public/index.html` | The Screen |
| `lib/score.js` | The Brain (replace with an AI API call in production) |
| `server.js` | The Pipes (API + flow) |
| `data/*.json` | The Memory (leads + consent log) |

## Turn on real AI + real email/SMS

The app runs with no keys (rules-based scoring, simulated confirmations). To go live:

```bash
cp .env.example .env     # then paste your keys into .env
node server.js
```

- **ANTHROPIC_API_KEY** → `lib/score.js` calls Claude to score "Mes leads du jour" for real (falls back to rules if the call fails).
- **BREVO_API_KEY** → `lib/notify.js` sends the real confirmation **email + SMS**; the link in them hits `GET /confirm?token=...`, which logs the consent and marks the lead callable. That's the true double opt-in.

On startup the console shows whether each is `ON` or `OFF`.

## Storage: Supabase (EU)

The app stores data in local JSON files by default, and switches to **Supabase** the moment you set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`:

1. Create a Supabase project in an **EU region** (e.g. Frankfurt) — required for GDPR.
2. Open the SQL editor and run `supabase/schema.sql` (creates `leads` + `properties`).
3. Paste the project URL + service key into `.env`.

On startup the console shows `Store: Supabase (EU)` or `Store: JSON files (local)`.

## Pricing + payments (Stripe) + login

`data/plans.json` drives the **Tarifs** tab; the buttons go to **`/login`** to sign up.

The signup flow is real:
1. Agent picks a plan → `/api/signup` creates an account (hashed password) and opens **Stripe Checkout** (subscription).
2. On success, Stripe calls **`/api/stripe/webhook`** → the account is set to `active`.
3. The agent logs in (`/api/login`) → a session cookie is set → `/api/me` returns their account.

With **no Stripe keys**, checkout is *simulated*: the account auto-activates so you can test the whole path. To go live: set `STRIPE_SECRET_KEY`, create one subscription **price per plan** in Stripe and put the IDs in `STRIPE_PRICE_SOLO/TEAM/AGENCY`, and set `STRIPE_WEBHOOK_SECRET`.

> Note: this login is MVP-grade (hashed password + signed cookie). For production, use **Supabase Auth** and Stripe's official SDK for webhook verification.

## What's left for full production

- Add **Stripe** for real subscriptions + login per agent (the Tarifs page is ready for it).
- Pull live data from **DVF / cadastre / permits** into the `properties` table.
- Handle the SMS **"OUI" reply** via a Brevo inbound webhook (the email/SMS *link* already works today).
- Enable **Row Level Security** in Supabase before go-live.

The loop — score, capture, confirm consent, make callable, store in the EU — is real. The rest is Stripe + live data.
