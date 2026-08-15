/**
 * Deterministic environment for the whole test run.
 *
 * Lives in its own module, imported before anything else, because several `lib/` modules
 * read env at IMPORT time — lib/openai.ts constructs its client in the module body and
 * throws without OPENAI_API_KEY. Setting these in setup.ts's body would be too late:
 * ES imports evaluate first, so helpers/real-providers.ts would already have pulled in
 * lib/gmail.ts (and through it lib/openai.ts) against an empty environment.
 *
 * Values are fake but shaped like the real ones; lib/tiers.ts reads product ids straight
 * off process.env, so its tests assert against exactly these.
 */


const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  DIRECT_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  NEXT_PUBLIC_API_URL: "https://test.neatmail.app",

  CLERK_SECRET_KEY: "sk_test_clerk",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_clerk",
  CLERK_WEBHOOK_SECRET: "whsec_test_clerk",

  ENCRYPTION_KEY: "test-encryption-key-do-not-use-in-production",
  CRON_SECRET: "test-cron-secret",
  AUTHORIZATION_KEY: "test-authorization-key",
  OPENAI_API_KEY: "sk-test-openai",
  RESEND_API_KEY: "re_test_resend",
  CLASSIFICATION_API_URL: "https://classify.test.local",
  DRAFT_API_URL: "https://draft.test.local",
  TELEGRAM_BOT_TOKEN: "test:telegram-token",
  BULLBOARD_PASSWORD: "test-bullboard-password",

  DODO_API: "test-dodo-key",
  DODO_WEBHOOK_SECRET: "whsec_test_dodo",
  DODO_WEB_URL: "https://checkout.test.local",

  DODO_PRODUCT_ID_PRO_MONTHLY_INDIA: "pdt_pro_monthly_in",
  DODO_PRODUCT_ID_PRO_MONTHLY_GLOBAL: "pdt_pro_monthly_global",
  DODO_PRODUCT_ID_PRO_ANNUAL_INDIA: "pdt_pro_annual_in",
  DODO_PRODUCT_ID_PRO_ANNUAL_GLOBAL: "pdt_pro_annual_global",
  DODO_PRODUCT_ID_MAX_MONTHLY_INDIA: "pdt_max_monthly_in",
  DODO_PRODUCT_ID_MAX_MONTHLY_GLOBAL: "pdt_max_monthly_global",
  DODO_PRODUCT_ID_MAX_ANNUAL_INDIA: "pdt_max_annual_in",
  DODO_PRODUCT_ID_MAX_ANNUAL_GLOBAL: "pdt_max_annual_global",

  // Comma-separated on purpose — the id list is additive so retired ids stay readable.
  DODO_ADDON_MAILBOX_MONTHLY_INDIA: "addon_mbx_monthly_in",
  DODO_ADDON_MAILBOX_MONTHLY_GLOBAL: "addon_mbx_monthly_global",
  DODO_ADDON_MAILBOX_ANNUAL_INDIA: "addon_mbx_annual_in",
  DODO_ADDON_MAILBOX_ANNUAL_GLOBAL: "addon_mbx_annual_global",
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] = value;
}

