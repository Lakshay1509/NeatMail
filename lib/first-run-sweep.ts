import { getGmailClient, archiveGmailMessages } from "@/lib/gmail";

/**
 * First-run "Kaboom" sweep.
 *
 * The point of this feature is a big day-1 dopamine hit with ZERO AI spend: we
 * never call the classification model. Instead we ride Gmail's own free signals:
 *
 *  - Gmail already sorts bulk mail into CATEGORY_* buckets (promotions, social,
 *    updates, forums). Those are the "never needed you" piles, pre-classified by
 *    Google at no cost to us.
 *  - We only ever touch mail currently in the inbox, and exclude anything the
 *    user explicitly STARRED. We never touch the Primary category.
 *  - Counts are of CONVERSATIONS (threads), matching what the user sees in the
 *    Gmail tabs — not raw message counts, which run higher.
 *
 * Cost per sweep is a handful of `messages.list` calls (5 units each) plus
 * `batchModify` calls (50 units / up to 1000 messages). A 5k-mail inbox is
 * ~300 quota units against a 15k/min budget — and $0 of model spend.
 */

// The label stamped on everything the sweep archives, so a one-tap Undo can put
// it all back (re-add INBOX, drop this label). Nested under a "NeatMail" parent.
export const SWEPT_LABEL_NAME = "NeatMail/Swept";

// Gmail categories are mutually exclusive (a message has exactly one), so bucket
// counts can be summed with no double-counting.
export interface SweepBucket {
  key: string;
  label: string;
  // Gmail system label for this category. We match by labelIds — NOT a
  // `category:… in:inbox` search string — because that's the only way to be
  // certain we hit inbox mail and NEVER archived mail: an archived promo keeps
  // its CATEGORY_PROMOTIONS label but loses INBOX, and the search-string form
  // leaks those back in. labelIds:["INBOX", <cat>] requires BOTH labels.
  categoryLabelId: string;
}

// Safety rail: never auto-archive mail the user explicitly STARRED. We do NOT
// exclude is:important — Gmail auto-applies "important" to a large, algorithmic
// share of mail (not a user signal), importance doesn't remove a message from its
// category tab, and excluding it badly undercounts the real pile. Passed as `q`
// alongside labelIds.
const SWEEP_EXCLUDE_Q = "-is:starred";

export const SWEEP_BUCKETS: SweepBucket[] = [
  { key: "promotions", label: "Promotions", categoryLabelId: "CATEGORY_PROMOTIONS" },
  { key: "social", label: "Social", categoryLabelId: "CATEGORY_SOCIAL" },
  { key: "updates", label: "Updates", categoryLabelId: "CATEGORY_UPDATES" },
  { key: "forums", label: "Forums", categoryLabelId: "CATEGORY_FORUMS" },
];

// Shared list filter for every count/collect call: inbox AND the category, minus
// anything flagged. Requiring the INBOX label is what guarantees we never touch
// already-archived mail.
function bucketListParams(bucket: SweepBucket) {
  return {
    userId: "me",
    labelIds: ["INBOX", bucket.categoryLabelId],
    q: SWEEP_EXCLUDE_Q,
  };
}

const BUCKET_BY_KEY = new Map(SWEEP_BUCKETS.map((b) => [b.key, b]));

// Hard ceiling on how many messages one sweep collects, so a giant mailbox can't
// spin the worker forever. Well above any realistic inbox backlog.
const MAX_SWEEP_MESSAGES = 25_000;
const LIST_PAGE_SIZE = 500;

type Gmail = Awaited<ReturnType<typeof getGmailClient>>;

export interface SweepBucketCount {
  key: string;
  label: string;
  count: number;
}

// Upper bound on how far the preview counts per bucket. `messages.list`
// resultSizeEstimate is unreliable (it's a guess, not a count), so we tally real
// message ids instead — capped so a huge inbox can't make the dashboard load
// paginate forever. Past the cap the banner just shows "5,000+".
const PREVIEW_COUNT_CAP = 5000;

// Counts CONVERSATIONS (threads), not messages — that's the unit the user sees in
// Gmail's tabs. messages.list counts each message in a thread separately and runs
// higher than the inbox shows. Tallies real thread ids, paginated, capped.
async function countThreads(
  gmail: Gmail,
  bucket: SweepBucket,
): Promise<{ count: number; capped: boolean }> {
  let count = 0;
  let pageToken: string | undefined;

  do {
    const res = await gmail.users.threads.list({
      ...bucketListParams(bucket),
      maxResults: LIST_PAGE_SIZE,
      fields: "threads/id,nextPageToken",
      pageToken,
    });
    count += res.data.threads?.length ?? 0;
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && count < PREVIEW_COUNT_CAP);

  return { count, capped: Boolean(pageToken) && count >= PREVIEW_COUNT_CAP };
}

/**
 * Preview for the dashboard banner. Counts CONVERSATIONS per bucket (threads,
 * capped, no bodies, no AI) so the headline number matches what the user sees in
 * their Gmail tabs. A few `threads.list` calls per bucket — cheap.
 */
export async function previewFirstRunSweep(
  userId: string,
): Promise<{ total: number; buckets: SweepBucketCount[]; capped: boolean }> {
  const gmail = await getGmailClient(userId);

  const buckets = await Promise.all(
    SWEEP_BUCKETS.map(async (bucket) => {
      try {
        const { count, capped } = await countThreads(gmail, bucket);
        return { key: bucket.key, label: bucket.label, count, capped };
      } catch (err) {
        console.error(`[first-sweep] preview failed for bucket ${bucket.key}:`, err);
        return { key: bucket.key, label: bucket.label, count: 0, capped: false };
      }
    }),
  );

  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  const capped = buckets.some((b) => b.capped);
  return {
    total,
    buckets: buckets.map(({ key, label, count }) => ({ key, label, count })),
    capped,
  };
}

// Walks the selected buckets and collects real message ids (deduped) up to the
// cap. Unlike the preview this paginates, since we need exact ids to archive.
async function collectSweepIds(
  gmail: Gmail,
  bucketKeys: string[],
): Promise<string[]> {
  const ids = new Set<string>();

  for (const key of bucketKeys) {
    const bucket = BUCKET_BY_KEY.get(key);
    if (!bucket) continue;

    let pageToken: string | undefined;
    do {
      const res = await gmail.users.messages.list({
        ...bucketListParams(bucket),
        maxResults: LIST_PAGE_SIZE,
        pageToken,
      });

      for (const msg of res.data.messages ?? []) {
        if (msg.id) ids.add(msg.id);
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && ids.size < MAX_SWEEP_MESSAGES);

    if (ids.size >= MAX_SWEEP_MESSAGES) break;
  }

  return [...ids];
}

// Finds or creates the NeatMail/Swept label. Mirrors the labelling flow the
// gmail-mail worker uses. Hidden from the label list so it doesn't clutter the
// sidebar — it exists purely to power Undo.
async function getOrCreateSweptLabel(gmail: Gmail): Promise<string> {
  const existing = await gmail.users.labels.list({ userId: "me" });
  const found = existing.data.labels?.find((l) => l.name === SWEPT_LABEL_NAME);
  if (found?.id) return found.id;

  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: SWEPT_LABEL_NAME,
      labelListVisibility: "labelHide",
      messageListVisibility: "hide",
    },
  });
  return created.data.id!;
}

export interface RunSweepResult {
  matched: number;
  archived: number;
  failed: number;
}

/**
 * The Kaboom. Collect every id in the chosen buckets, then archive them (remove
 * INBOX) while stamping the Swept label in the same batchModify call so Undo can
 * reverse it. Archive never deletes — mail stays in All Mail.
 */
export async function runFirstRunSweep(
  userId: string,
  bucketKeys: string[] = SWEEP_BUCKETS.map((b) => b.key),
): Promise<RunSweepResult> {
  const gmail = await getGmailClient(userId);

  const ids = await collectSweepIds(gmail, bucketKeys);
  if (ids.length === 0) return { matched: 0, archived: 0, failed: 0 };

  const sweptLabelId = await getOrCreateSweptLabel(gmail);

  const result = await archiveGmailMessages(userId, ids, [sweptLabelId]);
  const archived = result.archivedIds?.length ?? 0;

  return {
    matched: ids.length,
    archived,
    failed: ids.length - archived,
  };
}

// Gmail rejects batchModify calls over 1000 ids; chunk to stay under it.
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Undo: put everything the sweep archived back in the inbox. We find the swept
 * mail by the label (not a search query, so it's exact), re-add INBOX and drop
 * the Swept label. Best-effort and idempotent — a second run just finds nothing.
 */
export async function undoFirstRunSweep(
  userId: string,
): Promise<{ restored: number }> {
  const gmail = await getGmailClient(userId);

  const labels = await gmail.users.labels.list({ userId: "me" });
  const sweptLabelId = labels.data.labels?.find(
    (l) => l.name === SWEPT_LABEL_NAME,
  )?.id;
  if (!sweptLabelId) return { restored: 0 };

  // Collect every message still carrying the Swept label.
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({
      userId: "me",
      labelIds: [sweptLabelId],
      maxResults: LIST_PAGE_SIZE,
      pageToken,
    });
    for (const msg of res.data.messages ?? []) {
      if (msg.id) ids.push(msg.id);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < MAX_SWEEP_MESSAGES);

  if (ids.length === 0) return { restored: 0 };

  let restored = 0;
  // Sequential batches for the same quota reason the archive path chunks.
  for (const batch of chunk(ids, 1000)) {
    try {
      await gmail.users.messages.batchModify({
        userId: "me",
        requestBody: {
          ids: batch,
          addLabelIds: ["INBOX"],
          removeLabelIds: [sweptLabelId],
        },
      });
      restored += batch.length;
    } catch (err) {
      console.error("[first-sweep] undo batch failed:", err);
    }
  }

  return { restored };
}
