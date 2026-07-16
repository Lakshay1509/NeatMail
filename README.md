<div align="center">
  <h1>NeatMail</h1>
  <h2><strong>Get to inbox zero faster</strong></h2>
  <p>NeatMail is an <strong>AI email assistant for Gmail and Outlook</strong> that organizes priority emails, auto-labels your inbox, and drafts replies in your own voice — so you can clear your inbox in less time.</p>

  <p>
    <a href="https://www.neatmail.app">Website</a> •
    <a href="https://www.neatmail.app/pricing">Pricing</a> •
    <a href="https://www.neatmail.app/blog">Blog</a> •
    <a href="#built-for-your-team--industry">Use Cases</a> •
    <a href="https://www.neatmail.app/tools">Free Tools</a> •
    <a href="#features">Features</a> •
    <a href="#getting-started">Getting Started</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/license-ELv2-blue.svg" alt="License" />
    <img src="https://img.shields.io/badge/TypeScript-5.0-blue" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Next.js-16.1-black" alt="Next.js" />
    <img src="https://img.shields.io/badge/React-19.2-blue" alt="React" />
  </p>

  <img src=".github/workflows/assets/hero.png" alt="NeatMail Hero" width="800" />
</div>

---

## Table of Contents

- [What is NeatMail?](#what-is-neatmail)
- [Features](#features)
- [Built for Your Team & Industry](#built-for-your-team--industry)
- [Guides & Resources](#guides--resources)
- [Free Email Tools](#free-email-tools)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## What is NeatMail?

NeatMail is an [email management platform](https://www.neatmail.app) that automatically organizes your Gmail and Outlook inboxes in real-time. No complicated setup, no manual sorting — just clean, organized emails labeled exactly where you need them.

Want to see how it stacks up? Read [Superhuman vs NeatMail: email productivity compared (2026)](https://www.neatmail.app/blog/superhuman-vs-neatmail-email-productivity-compared-2026), check out our [pricing plans](https://www.neatmail.app/pricing), or learn more [about the team](https://www.neatmail.app/about).

---

## Features

- **Gmail & Outlook Integration:** Connect in minutes via OAuth. Labels sync directly in real time.
- **Smart Email Labeling:** AI automatically categorizes incoming emails into labels like **Action Needed** or **Pending Response**.
- **Custom Labels:** Create personalized label systems to match your exact workflow.
- **AI-Powered Draft Replies:** Auto-generate context-aware draft responses based on your conversation history and writing tone. See [how AI draft generation actually works](https://www.neatmail.app/blog/how-ai-draft-generation-actually-works-in-neatmail-context-pipeline-explained).
- **One-Click Unsubscribe:** Instantly remove unwanted newsletters to keep your inbox clutter-free.
- **Auto-Archive Rules:** Set rules to automatically archive emails based on labels, senders, or categories.
- **Follow-Ups:** Never drop a thread — NeatMail surfaces emails that need a nudge. Learn [how to handle email follow-ups](https://www.neatmail.app/blog/how-to-handle-email-follow-ups).
- **Telegram Integration:** Receive alerts, set routing rules, and approve AI drafts directly from Telegram.

See the full [feature list and pricing →](https://www.neatmail.app/pricing)

---

## Product Screenshots

<table align="center">
  <tr>
    <td align="center">
      <img src=".github/workflows/assets/dashboard.png" alt="Dashboard" />
      <br />
      <b>Dashboard</b>
    </td>
    <td align="center">
      <img src=".github/workflows/assets/labels.png" alt="Smart Labels" />
      <br />
      <b>Smart Labels</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src=".github/workflows/assets/draft.png" alt="AI Drafts" />
      <br />
      <b>AI Drafts</b>
    </td>
    <td align="center">
      <img src=".github/workflows/assets/unsubscribe.png" alt="One-Click Unsubscribe" />
      <br />
      <b>One-Click Unsubscribe</b>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src=".github/workflows/assets/cleanup.png" alt="One-Click Cleanup" />
      <br />
      <b>One-Click Cleanup</b>
    </td>
    <td align="center">
      <img src=".github/workflows/assets/follow_up.png" alt="Follow-Ups" />
      <br />
      <b>Follow-Ups</b>
    </td>
  </tr>
</table>

---

## Product Video

<a href="https://www.youtube.com/watch?v=_as6DVg6wvY" target="_blank">
  <img src="https://img.youtube.com/vi/_as6DVg6wvY/maxresdefault.jpg" alt="NeatMail Product Video" width="100%" />
</a>

---

## Built for Your Team & Industry

NeatMail adapts to how different teams and industries handle email. Explore the workflow built for you:

**By role**

- [NeatMail for Founders](https://www.neatmail.app/for/founders)
- [NeatMail for Sales Teams](https://www.neatmail.app/for/sales-teams)
- [NeatMail for Customer Support](https://www.neatmail.app/for/customer-support)
- [NeatMail for Recruiters](https://www.neatmail.app/for/recruiters)
- [NeatMail for Consultants](https://www.neatmail.app/for/consultants)
- [NeatMail for Executive Assistants](https://www.neatmail.app/for/executive-assistants)

**By industry**

- [NeatMail for Law Firms](https://www.neatmail.app/for/law-firms)
- [NeatMail for Real Estate](https://www.neatmail.app/for/real-estate)
- [NeatMail for Accounting Firms](https://www.neatmail.app/for/accounting-firms)
- [NeatMail for MSPs](https://www.neatmail.app/for/msps)
- [NeatMail for Financial Advisors](https://www.neatmail.app/for/financial-advisors)
- [NeatMail for Healthcare Clinics](https://www.neatmail.app/for/healthcare-clinics)

---

## Guides & Resources

Practical guides from the [NeatMail blog](https://www.neatmail.app/blog) on inbox zero, email organization, and productivity:

- [How to manage your email inbox — the complete guide (2026)](https://www.neatmail.app/blog/how-to-manage-email-inbox-complete-guide-2026)
- [Inbox zero when you get 100+ emails a day](https://www.neatmail.app/blog/inbox-zero-100-emails-a-day)
- [Inbox zero for freelancers](https://www.neatmail.app/blog/inbox-zero-for-freelancers)
- [Best email filters and folders for inbox zero](https://www.neatmail.app/blog/best-email-filters-folders-inbox-zero)
- [Email labels vs folders — which should you use?](https://www.neatmail.app/blog/email-labels-vs-folders)
- [How to stop newsletter clutter in Gmail (2026)](https://www.neatmail.app/blog/how-to-stop-newsletter-clutter-gmail-2026)
- [How to handle promotional & marketing emails](https://www.neatmail.app/blog/how-to-handle-promotional-emails-marketing)
- [Open-source email assistant — 2026 guide](https://www.neatmail.app/blog/open-source-email-assistant-2026-guide)
- [Superhuman vs NeatMail — email productivity compared (2026)](https://www.neatmail.app/blog/superhuman-vs-neatmail-email-productivity-compared-2026)

See all posts on the [blog →](https://www.neatmail.app/blog) · Track updates in the [changelog](https://www.neatmail.app/changelog).

---

## Free Email Tools

Free, no-signup [email tools](https://www.neatmail.app/tools) from NeatMail:

- [Gmail Filter Generator](https://www.neatmail.app/tools/gmail-filter-generator)
- [Unsubscribe Email Generator](https://www.neatmail.app/tools/unsubscribe-email-generator)
- [Email Header Parser](https://www.neatmail.app/tools/email-header-parser)
- [SPF Record Generator](https://www.neatmail.app/tools/spf-record-generator)
- [Spam Word Checker](https://www.neatmail.app/tools/spam-word-checker)
- [Email Read Time Calculator](https://www.neatmail.app/tools/email-read-time)
- [Email Open Rate Checker](https://www.neatmail.app/tools/email-rate-open-checker)
- [Meeting Agenda Generator](https://www.neatmail.app/tools/meeting-agenda-generator)
- [Meeting Cost Calculator](https://www.neatmail.app/tools/meeting-cost-calculator)
- [Text Case Converter](https://www.neatmail.app/tools/text-case-converter)
- [Remove Duplicate Lines](https://www.neatmail.app/tools/remove-duplicate-lines)

---

## Getting Started

### Prerequisites
- [Bun](https://bun.sh) (this project's package manager) and Node.js 20+
- PostgreSQL database
- Redis instance (e.g., Upstash)
- Third-party credentials for:
  - **Clerk** (Authentication)
  - **OpenAI** or **Azure OpenAI** (AI classification & drafts)
  - **Google Cloud Console** (Gmail API & Pub/Sub Webhooks)
  - **Microsoft Entra** (Outlook API & Webhooks)
  - **BullMQ** (Background jobs and queues — with Bull Board UI at `/api/bullboard`)
  - **DodoPay** (Payments)
  - **Resend** (Transactional emails)
  - **Telegram** (Bot token for chat integrations)

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/Lakshay1509/NeatMail.git
   cd neatmail
   ```

2. Install dependencies
   ```bash
   bun install
   ```

3. Set up environment variables
   ```bash
   cp .env.example .env.local
   ```

4. Set up the database
   ```bash
   bunx prisma db push
   bunx prisma generate
   ```

5. Run the development server
   ```bash
   bun run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Architecture

```mermaid
graph TD
    subgraph Email Providers
        Inbox[Gmail / Outlook]
        PubSub[Google Pub/Sub / MS Graph]
    end

    Inbox -->|Push Notification| PubSub
    PubSub -->|Webhook| API[NeatMail API]

    subgraph Core Processing
        API -->|Enqueue Job| BullMQ[BullMQ Worker]
        BullMQ -->|Fetch Full Email| Inbox
        BullMQ -->|Analyze Email| AI[OpenAI / Azure]
        AI -->|Labels & Drafts| BullMQ
        BullMQ -->|Apply Labels & Drafts| Inbox
    end

    subgraph Data & State
        BullMQ -->|Store Metadata| DB[(PostgreSQL)]
        BullMQ -->|Cache & Deduplication| Redis[(Redis)]
    end

    subgraph Notifications
        BullMQ -->|Send Alerts| Telegram[Telegram Bot]
    end
```

---

## Tech Stack

- **Frontend**: Next.js 16.1.1, React 19, Tailwind CSS 4, shadcn/ui, TanStack Query
- **Backend**: Hono.js, Prisma, PostgreSQL, Redis (Upstash), Clerk, BullMQ
- **AI**: OpenAI GPT-4 Mini
- **Integrations**: Google APIs, Microsoft Graph API, DodoPay, Svix

---

## Configuration

Refer to the code comments and documentation for detailed setup instructions for the Gmail API, Outlook API, and Clerk. Webhooks are central to how NeatMail works — make sure your Google Cloud Pub/Sub and Clerk webhook endpoints are correctly configured before testing.

---

## Deployment

NeatMail is optimized for Vercel.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Lakshay1509/NeatMail)

1. Deploy to Vercel and configure environment variables.
2. Run database migrations: `npx prisma migrate deploy`
3. Point your webhooks (Pub/Sub, Clerk, DodoPay) to the new domain.

---

## Contributing

1. Fork the project
2. Create your feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a pull request

---

## License

Distributed under the Elastic License 2.0. See `LICENSE` for more information.

---

<div align="center">
  <p>Built by the NeatMail team — <a href="https://www.neatmail.app">neatmail.app</a></p>
  <p>
    <a href="https://www.neatmail.app/pricing">Pricing</a> •
    <a href="https://www.neatmail.app/blog">Blog</a> •
    <a href="https://www.neatmail.app/tools">Free Tools</a> •
    <a href="https://www.neatmail.app/about">About</a> •
    <a href="https://www.neatmail.app/privacy">Privacy</a> •
    <a href="https://www.neatmail.app/terms-and-conditions">Terms</a>
  </p>
</div>
