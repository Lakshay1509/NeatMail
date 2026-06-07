# NeatMail Pricing Strategy

> **Last updated:** June 2026
> **Status:** Proposed — not yet implemented
> **Payment provider:** DodoPay

---

## Current State

- **Single tier:** $7/mo (Pro)
- **Free trial:** 7 days, no card required
- **Regional pricing:** Separate DodoPay product IDs for India vs Global
- **No public pricing page** — users discover pricing through the subscription modal

---

## Recommended Tiers

|                     | **Free**        | **Pro**               | **Max**                  |
| ------------------- | --------------- | --------------------- | ------------------------ |
| **Monthly**         | $0              | **$9/mo**             | **$15/mo**               |
| **Annual**          | —               | $7.50/mo ($90/yr)     | $12.50/mo ($150/yr)      |
| **Annual discount** | —               | ~17%                  | ~17%                     |
|                     |                 |                       |                          |
| Email tracking      | 100 emails/mo   | Unlimited             | Unlimited                |
| Custom labels       | 3               | Unlimited             | Unlimited                |
| AI draft replies    | —               | 20/mo                 | Unlimited                |
| Email digest        | —               | ✓                     | ✓                        |
| Follow-up tracking  | —               | ✓                     | ✓                        |
| Telegram / Slack    | —               | ✓                     | ✓                        |
| Dashboard           | ✓               | ✓                     | ✓                |
| Archive rules       | —               | 5                     | Unlimited                |
| Support             | —               | —                     | Priority                 |

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

---

## DodoPay Setup Required

Each tier × region needs a separate product in DodoPay:

| Product | Env Var | Tier | Region |
| ------- | ------- | ---- | ------ |
| Pro India | `DODO_PRODUCT_ID_PRO_INDIA` | Pro | IN |
| Pro Global | `DODO_PRODUCT_ID_PRO_GLOBAL` | Pro | Non-IN |
| Max India | `DODO_PRODUCT_ID_MAX_INDIA` | Max | IN |
| Max Global | `DODO_PRODUCT_ID_MAX_GLOBAL` | Max | Non-IN |

Remove old `DODO_PRODUCT_ID_INDIA` and `DODO_PRODUCT_ID_GLOBAL`.

---

## Annual Pricing (optional, phase 2)

DodoPay supports billing intervals. When implementing annual:

1. Create annual-priced product variants in DodoPay (4 additional products)
2. Add monthly/annual toggle on the pricing page
3. Offer ~17% discount (2 months free) to lock in revenue and reduce churn

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

**Is there a free trial?** Yes — 7 days of Pro, no card required.

**What payment methods do you accept?** Cards and UPI (India) via DodoPay.

**Can I cancel anytime?** Yes. Your subscription won't renew and you'll keep access until the billing period ends.

---

## Implementation Checklist

- [ ] Create 4 DodoPay products (Pro/Max × India/Global)
- [ ] Update `.env.example` with new product ID env vars
- [ ] Add env vars to `.env.local` and deployment
- [ ] Build pricing page (`app/pricing/page.tsx`)
- [ ] Update checkout API to accept tier selection (`/api/checkout`)
- [ ] Add feature gating logic on Free tier
- [ ] Update `SubscriptionModal` to show tier options
- [ ] Add monthly/annual toggle (phase 2)

---

## Competitor Reference

| Product | Starting Price | Key Features |
| ------- | ------------- | ------------ |
| Spark | $7.99/mo | Smart inbox, team collaboration |
| Clean Email | $9.99/mo | Bulk cleaning, unsubscribe |
| Edison Mail | $14.99/mo | AI assistant, travel tracking |
| Superhuman | $30/mo | Speed-focused, AI triage |
| Shortwave | $7/mo | AI assistant, bundles |

NeatMail's differentiator: **AI drafts + smart labels + multi-platform (Gmail/Outlook) all in one.**
