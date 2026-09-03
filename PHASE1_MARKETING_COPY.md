# Phase 1: Marketing Copy Foundation

This document consolidates all marketing copy for Phase 1 (Friction Reduction) implementation.

---

## 📋 Contents

1. [Demo Dashboard Copy](#demo-dashboard-copy)
2. [Hero Section Variations](#hero-section-variations)
3. [Feature Descriptions](#feature-descriptions)
4. [Onboarding Tooltips](#onboarding-tooltips)
5. [Competitor Comparison](#competitor-comparison)

---

## Demo Dashboard Copy

**Hero Text:**
Welcome to a perfectly organized inbox. Explore this live preview to see exactly how hours of manual email sorting disappear into automated workflows.

**"Labeled Emails" Section:**
Watch incoming chaos instantly transform into prioritized clarity. Critical messages surface immediately, while newsletters wait quietly for later.

**"AI Drafts" Section:**
Context-aware replies are pre-written before the thread is even opened. Turn a blank screen into a polished, ready-to-send message with just a quick review.

**"Time Saved" Section:**
Track the exact hours reclaimed from tedious inbox management. Watch those reclaimed minutes turn into hours for deep, focused work.

**CTA Button:**
Let's organize your inbox

---

## Hero Section Variations

### Variation 1: The Speed Play
- **Headline:** Inbox zero in minutes, not hours
- **Subheadline:** AI labels emails. You decide what's next.
- **CTA:** Try Free Demo

### Variation 2: The Control Play  
- **Headline:** Your email. Your rules. No chaos.
- **Subheadline:** Automated labeling that actually works.
- **CTA:** Start 7-Day Free Trial

### Variation 3: The Clarity Play
- **Headline:** See what matters. Act faster.
- **Subheadline:** AI organizes email. You focus on work.
- **CTA:** Get Started Free

**Recommendation:** Test Variation 1 first (speed resonates with busy professionals). A/B test with Variation 2 after 100 signups.

---

## Feature Descriptions

### Feature 1: Smart Email Labeling
- **Headline:** Spot priority messages instantly
- **Description:** Stop losing 45 minutes a week digging through a flooded inbox. AI automatically categorizes incoming messages, surfacing critical updates while keeping routine noise out of your primary view.
- **Use Case:** Client invoices route automatically to an "Action Required" folder while internal newsletters go to "Read Later."

### Feature 2: AI-Powered Draft Replies
- **Headline:** Cut response times by 80 percent
- **Description:** Eliminate the friction of staring at a blank reply window. Context-aware AI generates complete drafts based on thread history, turning writing into a quick review process.
- **Use Case:** Automatically generate a detailed follow-up response to a potential client asking for your standard pricing tier.

### Feature 3: Auto-Archive Rules
- **Headline:** Maintain a permanently clear inbox
- **Description:** Prevent daily notification buildup from overwhelming your focus. Custom rules silently sweep low-value messages out of your primary view while preserving them securely for future searches.
- **Use Case:** Route daily software build success alerts directly to the archive without triggering a desktop notification.

### Feature 4: Telegram Alerts
- **Headline:** Step away from your desk confidently
- **Description:** Stop compulsively checking your inbox for a pending decision. Immediate Telegram notifications ensure you only look at your phone when a high-priority sender reaches out.
- **Use Case:** Receive an instant Telegram ping when a key enterprise prospect finally signs and returns the contract.

### Feature 5: One-Click Unsubscribe
- **Headline:** Stop promotional clutter at the source
- **Description:** Reclaim your attention from marketing lists you never intentionally joined. A single click permanently blocks the sender, sparing you from spending 10 minutes a week hunting for tiny opt-out links.
- **Use Case:** Instantly sever ties with a persistent vendor newsletter that emails you three times a week.

---

## Onboarding Tooltips

**Tooltip 1: Label Creation**
- **Primary:** Click to create a label—organize your inbox your way
- **Alt A:** Create a label to sort emails by priority or topic
- **Alt B:** Organize emails into labels. Start with what matters most.

**Tooltip 2: Generate Draft Button**
- **Primary:** Let AI write your reply. Review and send in seconds.
- **Alt A:** AI writes the draft. You pick what to send.
- **Alt B:** Generate a smart reply based on your email history

**Tooltip 3: Email Item**
- **Primary:** Email is ready to go. Label it or draft a reply.
- **Alt A:** Ready to organize? Label this or generate a draft.
- **Alt B:** This email is waiting. Label it or reply automatically.

**Implementation:** Use with `react-joyride` on first login. Show sequentially: Label → Draft → Email. Auto-advance after 5 seconds or allow skip.

---

## Competitor Comparison

| Feature | NeatMail | Gmail Filters | Superhuman | HubSpot |
|---------|----------|---------------|-----------|----------|
| **Smart AI Labeling** | ✓ AI-powered | ✗ Manual | ✓ | Limited |
| **AI Draft Replies** | ✓ Context-aware | ✗ | ✓ | Limited |
| **Custom Labels** | ✓ Unlimited | ✓ Unlimited | ✓ Limited | ✓ Limited |
| **Auto-Archive** | ✓ Smart | ✓ Manual | ✓ | ✓ |
| **Telegram Integration** | ✓ Real-time | ✗ | ✗ | ✗ |
| **One-Click Unsubscribe** | ✓ Instant | ✗ | ✓ | ✗ |
| **Setup Time** | 2-3 min | 15+ min | 20+ min | 1+ hr |
| **Mobile** | Web (responsive) | Gmail app | Native | Salesforce app |
| **Free Tier** | ✓ 100 emails/mo | ✓ Unlimited | ✗ | ✗ |
| **Price (Monthly)** | Free → $9 | Free | $99 | $50+ (custom) |
| **Gmail Integration** | ✓ Real-time | ✓ Native | ✓ | ✓ Limited |
| **Outlook Integration** | ✓ Real-time | ✗ | ✗ | ✓ Limited |

**Key Differentiators:**
- Fastest setup (2-3 min vs. competitors' 15-60 min)
- Only solution supporting Gmail + Outlook equally
- Free tier includes AI features
- Most affordable ($9/mo vs. $99/mo or $50+/mo)

---

## Implementation Roadmap

### Immediate (This Week)
1. ✅ Copy created and reviewed
2. ✅ Ready for integration into landing page templates
3. ⏳ Integrate demo copy into `/demo` page
4. ⏳ Add hero variations to `/` page (A/B test)

### Phase 1b (Next Week)
1. Build `/features` page with feature descriptions
2. Add comparison table to landing page
3. Implement `react-joyride` guided tour with tooltips
4. Test onboarding flow with 10 beta users

### Phase 1c (Following Week)
1. Analyze which hero variation converts best
2. Refine tooltip copy based on user behavior
3. A/B test CTA button text
4. Prepare for Phase 2 (demo dashboard, auto-seeding)

---

## Success Metrics to Track

- **Landing page:** Hero variation conversion (goal: 20%+ CTR)
- **Demo page:** Click-through rate (goal: 15%+ of visitors)
- **Signup:** Completion rate (goal: 80%+ reach dashboard)
- **Day 1 onboarding:** Label creation (goal: 60%+), Draft generation (goal: 40%+)
- **Features page:** Time on page (goal: 2+ min), feature read (goal: 70%+ click through)

---

## Notes

- All copy adheres to NeatMail brand voice: **clean, sharp, focused, calm competence**
- No hype language, no exclamation marks, no "revolutionary" claims
- Every headline leads with **outcome**, not feature name
- Use cases are **specific and real** (not generic)
- Competitor comparison is **honest** (doesn't claim features we don't have)
