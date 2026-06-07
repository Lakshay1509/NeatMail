# NeatMail Pricing Strategy

> **Last updated:** June 2026
> **Status:** Implemented
> **Payment provider:** DodoPay

---

## Current State

- **Two paid tiers:** Pro ($9 / ₹299) and Max ($15 / ₹499)
- **Free trial:** 7 days of Max, no card required
- **Regional pricing:** Separate DodoPay product IDs for India vs Global (INR vs USD)
- **Annual billing:** Supported with ~17% discount
- **Pricing page:** `/billing` with region-aware tier cards

---

## Tiers

|                     | **Free**        | **Pro**               | **Max**                  |
| ------------------- | --------------- | --------------------- | ------------------------ |
| **Monthly (USD)**   | $0              | $9/mo                 | $15/mo                   |
| **Annual (USD)**    | —               | $7.50/mo ($90/yr)     | $12.50/mo ($150/yr)      |
| **Monthly (INR)**   | —               | ₹299/mo               | ₹499/mo                   |
| **Annual (INR)**    | —               | ₹208.25/mo (₹2,499/yr) | ₹415.83/mo (₹4,990/yr)  |
| **Annual discount** | —               | ~17%                  | ~17%                     |
|                     |                 |                       |                          |
| Email tracking      | 100 emails/mo   | Unlimited             | Unlimited                |
| Custom labels       | 3               | Unlimited             | Unlimited                |
| AI draft replies    | —               | 20/mo                 | Unlimited                |
| Email digest        | —               | ✓                     | ✓                        |
| Follow-up tracking  | —               | ✓                     | ✓                        |
| Telegram / Slack    | —               | ✓                     | ✓                        |
| Archive rules       | —               | 5                     | Unlimited                |
| Dashboard           | ✓               | ✓                      | ✓                        |
| Priority support    | —               | —                     | ✓                        |

### Upgrade triggers

| Tier | User hits the wall when... |
| ---- | -------------------------- |
| Free → Pro | They've used 100 tracked emails or want a 4th custom label |
| Pro → Max | They run out of AI drafts or want more archive rules |

---

## Why These Prices

- **$9 Pro:** Under the $10-15 competitor range (Spark, Clean Email, Edison). Credible without being "cheap."
- **$15 Max:** Upper end of competitor range. AI drafts are the premium differentiator — power users will pay $6 more for unlimited.
- **Free tier:** Serves as acquisition funnel. The 3-label limit is the primary upgrade trigger — once users taste auto-categorization, they want more.
- **Decoy effect:** Max exists as much to make Pro look like great value as it does to be bought outright.
- **India pricing:** ~90% discount from USD. Pro ₹299 (~$3.50), Max ₹499 (~$5.80). Priced for the Indian market while maintaining tier differentiation.

---

## Region-Aware Pricing

- **Detection:** `cf-ipcountry` header (Cloudflare). India users get INR prices; all others get USD.
- **Backend:** `lib/tiers.ts` — `getProductId(tier, country, interval)` maps to the correct DodoPay product. `getTierPrices(region)` returns `{ symbol, currency, monthly, annual }` for UI display.
- **Frontend:** `features/geo/use-geo.ts` fetches `GET /api/geo`. `components/Billing.tsx` and `components/SubscriptionModal.tsx` use `getTierPrices(region)` for region-aware display.
- **Checkout:** All endpoints read `cf-ipcountry` directly and call `getProductId()` — no dependency on the geo API.

---

## DodoPay Products

8 products total — 2 tiers (PRO, MAX) × 2 intervals (monthly, annual) × 2 regions (IN, GLOBAL):

| Product | Env Var | Tier | Interval | Region |
| ------- | ------- | ---- | -------- | ------ |
| Pro Monthly India | `DODO_PRODUCT_ID_PRO_MONTHLY_INDIA` | Pro | Monthly | IN |
| Pro Monthly Global | `DODO_PRODUCT_ID_PRO_MONTHLY_GLOBAL` | Pro | Monthly | Non-IN |
| Pro Annual India | `DODO_PRODUCT_ID_PRO_ANNUAL_INDIA` | Pro | Annual | IN |
| Pro Annual Global | `DODO_PRODUCT_ID_PRO_ANNUAL_GLOBAL` | Pro | Annual | Non-IN |
| Max Monthly India | `DODO_PRODUCT_ID_MAX_MONTHLY_INDIA` | Max | Monthly | IN |
| Max Monthly Global | `DODO_PRODUCT_ID_MAX_MONTHLY_GLOBAL` | Max | Monthly | Non-IN |
| Max Annual India | `DODO_PRODUCT_ID_MAX_ANNUAL_INDIA` | Max | Annual | IN |
| Max Annual Global | `DODO_PRODUCT_ID_MAX_ANNUAL_GLOBAL` | Max | Annual | Non-IN |

---

## Feature Gating

Feature enforcement points in the codebase:

| Feature | Gate location | Check |
| ------- | ------------- | ----- |
| Email tracking limit | `TrackedEmail.tsx`, add email endpoint | Count emails this month vs tier limit |
| Custom label limit | `CreateLabel.tsx` | Count user's labels vs tier |
| AI draft limit | `UserDraftPreference.tsx`, draft endpoint | Count drafts generated this month vs tier |
| Archive rules | `ArchiveRule` settings | Count rules vs tier |
| Analytics | `EmailStats.tsx` / `Dashboard.tsx` | Show/hide advanced charts |
| Telegram/Slack | `integrations/` page | Hide cards on Free tier |

---

## Pricing Page Copy (draft)

### Hero
> **Spend less time in your inbox.**
> NeatMail organizes your emails, drafts replies with AI, and makes sure nothing slips through.

### Tier descriptions

**Free** — For trying it out. Track up to 100 emails with 3 custom labels.

**Pro** (Recommended) — For professionals who live in their inbox. Unlimited tracking, AI drafts, and every integration.

**Max** — For power users. Unlimited AI drafts, advanced analytics, and priority support.

### FAQ

**Can I switch plans anytime?** Yes. Upgrade or downgrade from your billing settings.

**What happens when I hit a limit?** We'll let you know and you can upgrade instantly. No data is lost on downgrade.

**Is there a free trial?** Yes — 7 days of Max, no card required.

**What payment methods do you accept?** Cards and UPI (India) via DodoPay.

**Can I cancel anytime?** Yes. Your subscription won't renew and you'll keep access until the billing period ends.

---

## Implementation Checklist

- [x] Create 8 DodoPay products (Pro/Max × Monthly/Annual × India/Global)
- [x] Update `.env.example` with product ID env vars
- [x] Add env vars to `.env.local` and deployment
- [x] Build billing page (`app/billing/page.tsx`) with `components/Billing.tsx`
- [x] Update checkout API with tier selection and plan change (`/api/checkout`)
- [x] Add feature gating logic (`lib/tier-guard.ts`)
- [x] Update `SubscriptionModal` with region-aware pricing
- [x] Add monthly/annual toggle
- [x] Add India region-aware pricing via `GET /api/geo` and `features/geo/use-geo.ts`
- [x] Free trial gives Max-tier features

---

## Files

| File | Role |
|---|---|
| `lib/tiers.ts` | Tiers, limits, prices (USD + INR), product ID mapping, region helpers |
| `lib/tier-guard.ts` | Tier checks, feature access gating |
| `app/api/[[...route]]/geo.ts` | `GET /api/geo` → `{ region: "IN" \| "GLOBAL" }` |
| `features/geo/use-geo.ts` | Client hook for region detection |
| `components/Billing.tsx` | Billing page with region-aware tier cards |
| `components/SubscriptionModal.tsx` | Upsell modal with region-aware pricing table |
| `components/PlanChangeDialog.tsx` | Plan change confirmation with proration preview |
| `app/api/[[...route]]/checkout.ts` | Checkout, plan change, preview (all region-aware) |
| `lib/payement.ts` | DodoPay webhook handler, subscription tier assignment |
| `app/api/[[...route]]/freeTrial.ts` | Free trial activation |

## Competitor Reference

| Product | Starting Price | Key Features |
| ------- | ------------- | ------------ |
| Spark | $7.99/mo | Smart inbox, team collaboration |
| Clean Email | $9.99/mo | Bulk cleaning, unsubscribe |
| Edison Mail | $14.99/mo | AI assistant, travel tracking |
| Superhuman | $30/mo | Speed-focused, AI triage |
| Shortwave | $7/mo | AI assistant, bundles |

NeatMail's differentiator: **AI drafts + smart labels + multi-platform (Gmail/Outlook) all in one.**
