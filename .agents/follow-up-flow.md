# Follow-up Flow — labels & folders at each step

Last updated 2026-10-09. If behaviour changes, update this file.

## TL;DR — three rules

1. **They reply** → the thread takes **their reply's status** (one status per thread).
2. **Nobody did what they should in time** → **`Follow up`**, and the mail **comes back to your Inbox**, unread. It replaces the old status.
3. **You send in the thread** → `Follow up` and `Pending Response` **clear** (you've acted / answered, so the ball is in their court). `Action Needed` stays: replying doesn't mean the task is done.

**Two kinds of labels:**
- **Status** (what to do now): `Action Needed`, `Pending Response`, `Resolved`, `Follow up`. These **replace each other**, so a thread shows at most one.
- **Everything else** (what it's about): `Finance`, `Event update`, `Marketing`, `Read only`, `Automated alerts`, and **every label you create**. These are **never removed or moved** by NeatMail, and never replace a status. An invoice stays under `Finance` forever, and a CC'd "+1" (`Read only`) can't wipe `Pending Response`.

So a thread can show e.g. `Finance` + `Resolved`: one "about", one "do now".

"Nobody did what they should in time" covers three cases, and all three behave the same way:

| Case | Example | When `Follow up` appears |
|---|---|---|
| **Follow-up** | You asked Priya something and she went quiet | N days after your mail (`follow_up_preference.days`) |
| **Promise: they owe me** | Priya wrote "I'll send the contract by Friday" | After Friday, if nothing came |
| **Promise: I owe them** | You wrote "I'll send the quote by Wednesday" | ~30 min before Wednesday's deadline (plus a reminder email to you) |

Where `Follow up` shows:

| | Looks like |
|---|---|
| **Gmail** | `Follow up` label on the thread, unread, back in Inbox |
| **Outlook, folder mode OFF** | Mail in the **Inbox**, unread, **`Follow up`** tag (teal when NeatMail creates it). No separate folder |
| **Outlook, folder mode ON** | The thread's mail from the **Inbox and status folders** moves into the **"Follow up" folder** (there the folder *is* the label). Topic folders (e.g. "Finance"), Sent Items, Drafts, Archive and your own folders stay put |

Never brought back: mail you **deleted** or that went to **spam/junk**. Paused team members are skipped.

---

## Example (Outlook, folder mode OFF, follow-up delay 3 days)

**Mon 9:00 · Priya:** "Can you send a quote for 50 licenses?"
```
📥 Inbox       Priya: "Can you send a quote…"     [Pending Response]
```

**Mon 11:00 · You reply:** "Sure! Monthly or annual?" **→ rule 3.** `Pending Response` clears (you answered). It asks a question, so a 3-day timer starts.
```
📥 Inbox       Priya: "Can you send a quote…"     (no tag)
📤 Sent Items  You:   "Sure! Monthly or annual?"
```

**Thu 11:00 · No answer → rule 2.** Your mail comes back to the Inbox, tagged. An AI nudge draft is created.
```
📥 Inbox       Priya: "Can you send a quote…"     (no tag)
               You:   "Sure! Monthly or annual?"  [Follow up]  ← bold
```

**Thu 11:05 · You send the nudge** "Just checking in…" **→ rule 3.** `Follow up` clears, your Monday mail **goes back to Sent Items**, and a new 3-day timer starts.
```
📥 Inbox       Priya: "Can you send a quote…"     (no tag)
📤 Sent Items  You:   "Sure! Monthly or annual?"  ← back home
               You:   "Just checking in…"
```

**Fri 10:00 · Priya:** "Annual please, send the quote." **→ rule 1.** The timer is cancelled.
```
📥 Inbox       … earlier mail (no tag)
               Priya: "Annual please…"            [Pending Response]
```

**Fri 15:00 · Priya:** "Got it, thanks!" **→ rule 1.**
```
📥 Inbox       … earlier mail (no tag)
               Priya: "Got it, thanks!"           [Resolved]
```

With **folder mode ON** the story is the same, but Priya's mail lives in the status's folder (no status = Inbox): "Pending Response" → Inbox (you replied) → "Follow up" → Inbox (you nudged) → "Pending Response" → "Resolved". Your own mail is in Sent Items throughout, except while it's surfaced in "Follow up".

---

## The one exception: an open promise survives someone else's reply

Priya promised the contract by Friday. Saturday, NeatMail nudges you and `Follow up` appears on her mail. Then her colleague replies "looping in legal", but there's still no contract. **`Follow up` stays on Priya's mail** (the colleague's reply gets its own label too). A promise shouldn't vanish because someone else chimed in. It clears when Priya delivers or when you send something in the thread. (In Outlook folder mode her mail stays in "Follow up" while the colleague's reply goes to its own folder.) This only applies once a promise has been **nudged**. Before its deadline, a promise mail follows the normal rules.

## "Resolved"

| Who closes it | What happens |
|---|---|
| **They send "thanks, all sorted"** | Tagged `Resolved`, which replaces the old label. Onboarding suggests auto-archiving `Resolved` after 7 days. |
| **You answer** | `Follow up` and `Pending Response` clear (rule 3). If your answer asks something, a new timer starts. |
| **You add `Resolved` yourself** | Only logged as a categorizer correction. No effect on follow-ups. |

The `Resolved` label itself never stops anything. **Replies and sends** do.

---

## Under the hood (why it's built this way)

- **Status vs topic** (`STATUS_TAG_NAMES` in `lib/tags.ts`): only status labels replace each other and get stripped or moved. Topic/user labels are for finding mail later, so NeatMail never touches them (same idea as Fyxer's "respect user-applied labels"). This also stops weak rule-based labels (a CC'd reply → `Read only`, Promotions → `Marketing`) from wiping `Action Needed` / `Pending Response`.
- **NeatMail categories are only ever removed from older messages, never added.** Adding one would count as a user correction (`handleOutlookLabelCorrection` / `handleLabelCorrections`) and retrain the categorizer on a fake example. The only thing NeatMail adds to an older mail is `Follow up`, which isn't a category tag.
- **Only OLDER messages are touched.** A reply only strips labels from mail received before it, so two replies processed at the same time can't wipe each other's label.
- **Muted senders never drive the thread.** An auto-archived (muted) sender's reply still clears `Follow up`, but it never replaces the thread's label or moves the thread. Its promises aren't tracked either.
- **Outlook moves change message ids.** Every follow-up/consolidation move (`repointMovedMessage` in `lib/outlook.ts`) (1) marks the new id processed, because watched folders fire a "created" notification and the mail would be reprocessed as incoming, and (2) repoints `tracked_promise` and `email_tracked` to the new id. Otherwise the promise sweep would 404 and dismiss, and read status / un-mute / corrections would stop matching.
- **Promise directions:** a promise is only "kept" by the person who owes it. Inbound ("they owe me") is kept when *they* reply. Outbound ("I owe them") is kept when *you* send. Before 2026-10-09, the other person replying wrongly marked *your* promise kept, and the inbound sweep could grab overdue outbound promises. Both are fixed.
- **Retries are safe.** The Outlook follow-up job saves the moved id before anything else can fail, and a mail that's already gone or moved is skipped instead of failing 3 times.
- **Only mail NeatMail surfaced goes back to Sent Items.** It's recognised by being yours *and* carrying `Follow up` (category or folder), so a Bcc-to-self copy or mail you filed yourself is never moved. It comes back marked read. Backstop: an old sent mail reappearing in Sent Items (> 12h old) is never treated as a new send, so it can't start a second follow-up.
- **Folder mode, topic mail keeps its folder:** a mail surfaced out of e.g. "Finance" goes back to "Finance" when the follow-up ends.
- **If the promise lookup fails (Outlook),** the thread clean-up for that reply is skipped rather than risk dropping an open promise's `Follow up`.
- **Your sent mail only visits the Inbox (Outlook).** A follow-up has to *move* it out of Sent Items, because an Outlook mail lives in one folder. As soon as the follow-up is over (they reply or you send), it goes **back to Sent Items** (`returnOwnMail` in `consolidateOutlookThread`). Gmail never needs this, because SENT is a label there. Exception: an open, nudged "I owe them" promise stays surfaced until you deliver.
- Best-effort cleanup: if a label removal or move fails, it's logged and mail processing carries on.

## Known gaps

1. **`Action Needed` stays after you reply** (deliberate: replying doesn't mean the task is done). Archive-on-reply (thread leaves the Inbox after you answer) is a possible later setting.
2. **Old threads aren't cleaned up.** Threads labelled before 2026-10-09 fix themselves on their next reply, send or follow-up.
3. **Gmail, sending to yourself:** a send is only detected when the mail is in Sent and not in the Inbox, so mail you send to yourself won't clear `Follow up`.
4. **Outlook "Follow up" folder watching:** it's watched only if it existed when the subscription was last (re)created. Correctness doesn't depend on it.
5. **Threads over 100 messages** are only partly cleaned up (one Graph page).
6. `lib/tags.ts` says that labelling a mail `Resolved` drops the follow-up. That isn't true.
7. **Outlook: the clean-up runs after labelling.** If labelling a reply crashes, that reply's clean-up is skipped (the mail worker never retries a processed message, which predates this work). The next reply or send cleans up.

## Open decisions

- **Outlook AI drafts may not quote the earlier mails.** Drafts are created with a custom body. Check on a real mailbox.

## Code map

| What | Where |
|---|---|
| Gmail webhook routes sent vs inbox mail | `app/api/[[...route]]/gmail-webhook.ts` (`SENT && !INBOX` → `gmailSentQueue`) |
| You send (Gmail): clear `Follow up`, keep outbound promises, schedule follow-up | `bullmq/workers/process-gmail-sent.ts` |
| "Expects a reply?" decision (Jev) | `lib/sent-followup.ts` → `checkSentRequiresFollowUp` |
| Follow-up fires | `bullmq/workers/follow-up-draft.ts` |
| Promise "they owe me" overdue | `bullmq/workers/promise-sweep.ts` (INBOUND only) |
| Promise "I owe them" due soon | `bullmq/workers/promise-nudge.ts` |
| Gmail reply: cancel timer, keep promises, strip `Follow up` + other labels | `bullmq/workers/process-gmail-mail.ts` (search `[gmail-followup]`, `[gmail-one-label]`) |
| Outlook send + reply (same worker) | `bullmq/workers/process-outlook-mail.ts` (`isSentMessage` branch; `openPromiseMessageIds`; `consolidateOutlookThread`) |
| Shared: bring a mail back as `Follow up` | `lib/outlook.ts` → `surfaceOutlookFollowUp`; `lib/gmail.ts` → `stripGmailStatusLabels` |
| Which labels are "status" | `lib/tags.ts` → `STATUS_TAG_NAMES` |
| Shared: one label per Outlook conversation (+ move bookkeeping) | `lib/outlook.ts` → `consolidateOutlookThread`, `repointMovedMessage` |
| Outlook watched folders (Inbox, Sent Items, Follow up, user-picked) | `lib/outlook.ts` → `createOutlookSubscription` |
