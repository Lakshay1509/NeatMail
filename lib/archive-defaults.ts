// Shared by the onboarding modal, the auto-archive dialog, and the onboard +
// tag-archive routes. No server imports, so it's safe in a client bundle.

export const ARCHIVE_DURATIONS = [1, 3, 7, 14, 30, 60] as const;
export type ArchiveDuration = (typeof ARCHIVE_DURATIONS)[number];

// "1 day" not "24 hours" — the sweep runs daily, so sub-day precision overpromises.
export const ARCHIVE_DURATION_LABELS: Record<ArchiveDuration, string> = {
  1: "1 day",
  3: "3 days",
  7: "7 days",
  14: "14 days",
  30: "30 days",
  60: "60 days",
};

// Categories suggested for auto-archive at onboarding — mail whose relevance
// fades with time. Action Needed, Pending Response, Finance, and Event update
// are excluded on purpose: archiving those by age alone would hide open work.
export const ARCHIVE_DEFAULTS: { name: string; days: ArchiveDuration }[] = [
  { name: "Marketing", days: 1 },
  { name: "Automated alerts", days: 1 },
  { name: "Read only", days: 3 },
  { name: "Resolved", days: 7 },
];

export function isArchiveDuration(n: number): n is ArchiveDuration {
  return (ARCHIVE_DURATIONS as readonly number[]).includes(n);
}
