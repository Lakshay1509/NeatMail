// Built once and shared by the wizard and /onboard-complete so their payloads never drift.

export const ROLES = [
  { value: "founder", label: "Founder" },
  { value: "sales-manager", label: "Sales Manager" },
  { value: "account-executive", label: "Account Executive" },
  { value: "marketing-manager", label: "Marketing Manager" },
  { value: "product-manager", label: "Product Manager" },
  { value: "customer-success", label: "Customer Success" },
  { value: "operations", label: "Operations" },
  { value: "hr-recruiter", label: "HR / Recruiter" },
  { value: "engineer", label: "Engineer" },
  { value: "executive-assistant", label: "Executive Assistant" },
  { value: "consultant", label: "Consultant" },
  { value: "personal-use", label: "Personal use" },
  { value: "other", label: "Other" },
] as const;

// Skip generic domains so we don't seed "I'm a Founder at gmail.com".
const GENERIC_DOMAINS = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "outlook.fr",
  "outlook.de",
  "outlook.co.uk",
];

export interface OnboardAnswers {
  role?: string | null;
  tags?: string[];
  followUpEnabled?: boolean;
  followUpDays?: number;
}

// expectActivation is set only by /onboard-complete, never here.
export function buildOnboardPayload(answers: OnboardAnswers, email: string) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const domain = email.split("@")[1]?.toLowerCase() ?? "";

  let draftPrompt: string | undefined;
  const role = answers.role;
  if (role && role !== "personal-use" && role !== "other") {
    if (domain && !GENERIC_DOMAINS.includes(domain)) {
      const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role;
      draftPrompt = `I'm a ${roleLabel} at ${domain}.`;
    }
  }

  return {
    tags: answers.tags ?? [],
    draftPrefs: {
      enabled: true,
      fontColor: "#000000",
      fontSize: 14,
      timezone,
      ...(draftPrompt && { draftPrompt }),
    },
    digestPrefs: {
      enabled: true,
      deliveryTime: "10:00",
      timezone,
    },
    followUpPrefs: {
      enabled: answers.followUpEnabled ?? true,
      days: answers.followUpDays ?? 3,
      ai_drafts: true,
    },
  };
}
