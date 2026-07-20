# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.27.0] — 2026-07-20

### Added
- Engagement-based auto-archive rules — auto-mute senders a user consistently ignores (`fa765c5`)
- Feedback survey integration in the app (`e47b356`)

### Changed
- Email handling excludes self-sent messages from tracking and processing (`e47b356`)

## [1.26.0] — 2026-07-18

### Added
- First-run inbox sweep with preview and one-click undo (`718367a`)
- Auto-archive functionality for user tags (`3d52d66`)

### Changed
- Onboarding flow updated with trial plan features and savings display (`3edac70`)
- First-run sweep refined to exclude only starred messages and count conversations accurately (`c35e166`)
- Dashboard components reorganized for improved layout and clarity (`48e6ffb`)

### Removed
- InsightHighlights component and related new-senders logic (`79eb394`)

## [1.25.0] — 2026-07-16

### Added
- Extra mailbox add-ons for subscriptions — paid seats via DodoPay (`79ecf04`)
- `ConfirmDialog` for consistent destructive-action confirmations in TeamSettings (`0429ccc`)
- Teammate referral guard to prevent circular rewards (`7dffc91`)
- "Mailboxes" feature label; `formatFeatures` updated for tier limits (`eebb7ed`)
- Migration to backfill solo organizations for pre-existing signups (`d55e39d`)

### Changed
- Payment region inference switched from currency-based to plan-based resolution (`247a96f`)
- Presentment currency handling for recurring charges and credits (`d088e63`); `presentmentRecurring` renamed to `planRecurring` (`b209c7c`)
- `ExtraMailboxesCard` region logic now uses geo information (`e357d45`); styling improved (`9ee9e0a`)
- Billing page enhanced with additional information and support contact (`5c28edd`)
- OAuth error handling and reconnect notifications enhanced for Gmail and Outlook (`d87ea67`)
- README enhanced with clearer description, links, and team/industry use cases (`aee863f`)

### Fixed
- `DodoDisputeData.amount` corrected to string, matching DodoPay's webhook contract (`31c3e99`)

## [1.24.0] — 2026-07-14

### Added
- Organizations & teams — `organization` and `organization_members` models with roles (`7b72bac`)
- Organization-aware billing tier resolution for users (`10bf11d`)
- Organization hooks for invite, team, and member management (`cf10499`)
- Organization API, pages, components, and route registration (`59bb079`)
- Schema org fields and migrations for invite tokens, member active flag, and trial flag (`99d994a`)

### Changed
- Checkout, subscription, billing page, and user deletion updated with org support (`3ad6ae8`)
- AppSidebar, user settings, sign-in, onboarding, and Resend lib updated for orgs (`a3fcaae`)
- Outlook workers, watch activation, cron, and Gmail webhook updated for orgs (`4fead6b`)

## [1.23.0] — 2026-07-12

### Added
- Gmail processing queues and workers for incoming and sent messages (`08b3c9b`)
- Per-user burst limiter for Gmail processing to prevent mailbox flooding (`4243e75`)
- Edit-label functionality with validation and API integration (`877d91e`)
- New favicon assets and updated metadata for branding (`3d05a89`)

### Changed
- Migrated from Azure OpenAI to the OpenAI API (`e9f9cd2`)
- Classification polling timeout extended from 60s to 600s (`995b869`)
- Checkbox replaced with Switch in user preferences; save-state handling enhanced (`b9816f9`)
- Input validation for tag name/description; Dashboard greeting logic refined (`972a2fd`)

## [1.22.0] — 2026-07-09

### Added
- Referral system — referral code generation, tracking, and rewards (`4362291`)
- Billing portal access for subscriptions on hold (`3dfbb68`)

## [1.21.0] — 2026-07-07

### Added
- Chat session management and message persistence (`d81ab50`)
- Follow-up feature with a mandatory "Resolved" tag and related checks (`54df078`)
- Keyword-based attachment search for Outlook; fallback to most recent candidate for generic requests (`ff89298`, `17bd6f4`)

### Changed
- Email handling refactored to provider-agnostic types; Gmail/Outlook-specific implementations removed (`aea3dd6`)
- Chat markdown styling improved; email date formatting enhanced (`936cd17`)

### Removed
- "Discussion" label and related checks from email processing (`b8334ab`)

## [1.20.0] — 2026-07-02

### Added
- Attachment auto-resolution for drafts — file retrieval and attachment capabilities (`515873f`)
- Email subject and confidence level included in attachment resolution (`668567d`)
- Follow-up email functionality in the daily digest (`b211974`)
- Carousel on the sign-in page with new imagery (`9659124`)
- Comprehensive agent guide (`CLAUDE.md`) — build, architecture, pricing, and API details (`3423f78`)

### Changed
- Onboarding page enhanced with trust and reassurance messaging for card verification (`3105ba5`)
- Sign-in page header and description updated for clarity (`2894f43`)

### Fixed
- Pricing tiers updated for Pro and Max; free-tier option removed (`6b02768`)
- Tier degraded on trial expiry; watch deactivated on delete; watch teardown hardened (`9e86a06`)

## [1.19.0] — 2026-06-29

### Added
- Card-required free trial logic with an enhanced onboarding flow (`ca7489a`)
- Trial reminder system for card-required free trials (`9c0f408`)
- Reconnect reminder system to notify users when an OAuth token is revoked (`65c8c60`)
- `UnsubscribeFailedDialog` for improved unsubscribe error handling (`707c334`, `b221868`)

### Changed
- Pricing updated for PRO and MAX tiers; tier limits adjusted (`ac665a4`)
- `UserLabel` component handles loading states and stale data (`e016e92`)
- Navbar and AppSidebar layout spacing; sidebar width normalized (`1678406`)

## [1.18.0] — 2026-06-26

### Added
- New-senders tracking endpoint integrated into dashboard insights (`0afb377`)
- Dashboard email statistics and insights enhanced (`2988475`)

### Changed
- License updated to Elastic License 2.0; README updated for consistency (`ac5e120`)
- `ConditionalSidebar` hidden on the onboard-complete page (`40ac4b1`)
- Google API integration checks Gmail access and scopes (`a4fbc67`, `f08d6f3`)

## [1.17.0] — 2026-06-23

### Added
- 4-step onboarding wizard replacing the bare redirect, with an OAuth re-auth flow (`156255a`)
- `user_defined` property on tags for identification (`6b97612`)

### Changed
- Sign-in page redesigned with tagline, mascot, and trust badges (`fb84571`)
- Email digest sent only to users with an active subscription or trial (`0bae875`)
- Email classification: read-only/discussion tag handling and expanded `noReplyNeeded` read-only signals (`a05e23e`, `b995e51`, `22fdc1b`)

### Fixed
- "Follow-up" spelling corrected in sidebar items (`31b5b83`)

## [1.16.0] — 2026-06-19

### Added
- Follow-up system — detection, AI draft generation, and preference management (`d1baea5`)
- Follow-up limits and tracking for user preferences (`9b3a2ef`)
- Follow-up preferences in onboarding; default values in `EmailCategorizationModal` (`05b36d0`)
- Follow-up message handling for Gmail and Outlook — move to inbox, mark unread (`3e2d8b3`)
- Digest "Completed" tab with a dedicated API; digest section redesigned (`a24fe50`)
- Animated `BeamAvatar` component; `DigestRow` with formatted date/time (`b1d1fc3`)

### Changed
- `DailyDigestEmail` supports `message_id` and `is_gmail` for dynamic email links (`9906b38`)
- Trimmed digest emails increased from 5 to 10 (`2a0bf00`)
- Throttling added to the `sendNewMails` endpoint to avoid rate limits (`7d30495`)
- AI model parameters tuned for follow-up checks (`a6ed55c`, `aaa9482`)

## [1.15.0] — 2026-06-16

### Added
- PostHog tracking for user events and onboarding (`020d04b`)
- PostHog project token and host wired as Docker build args and env vars (`acf9d02`)

### Changed
- User-token upsert enhanced with email and Gmail provider check (`9fb5051`)
- Onboarding page title and sidebar visibility logic updated (`9f9a8c0`)
- Primary email address prioritized in user-related API responses (`50220a4`)

## [1.14.0] — 2026-06-13

### Added
- AI chat agent — backend tools (`create_draft`, `trash_messages`, web attachments) (`584cbe4`)
- Chat UI with markdown rendering and sidebar integration (`d71ebca`)
- Onboarding API integrated with the email categorization modal (`398e075`, `e03cdeb`)
- Loading steps and interval in `EmailCategorizationModal` during onboarding (`b8ba85a`)

### Changed
- `react-markdown` and `remark-gfm` added for chat markdown rendering (`71f7b0b`)

### Fixed
- Chat mobile: `dvh` viewport height, safe-area padding, reduced padding on small screens (`f8fddc7`, `46aad5c`)

### Docs
- `DESIGN.md` added to `notion/` (`ba64dba`)

## [1.13.0] — 2026-06-12

### Added
- Free trial activation with onboarding integration (`30dd6a5`)
- `OAuthError` class with enhanced error handling in the Gmail client (`ea7c0ed`)
- NeatMail footer on Gmail and Outlook draft emails (`ef31023`)

### Changed
- Tier-based feature restrictions and UI updates for free users (`068498b`)
- Confetti animation on the onboarding success dialog (`3fa8a0c`)
- Classification batch size reduced from 10 to 5 (`f45cb96`)
- "Action Needed" tag renamed to "Automated alerts" (`2f1d1b8`)

### Fixed
- Free trial users can select the PRO plan in billing (`d138110`)
- History ID updated as a string in Gmail webhook processing (`f90239e`)

## [1.12.0] — 2026-06-07

### Added
- Tier system — `Tier` enum and field on `user_tokens` with migration (`737b15c`)
- Core tier infrastructure — limits, webhook sync, tier hooks (`e78180d`)
- Tier-aware API endpoints — checkout, changePlan, preview, trial, limits (`7ac325c`)
- Frontend tier gating, onboarding flow, billing cards, and plan preview dialog (`9597702`)
- Region-aware pricing with INR support (`4359e35`)
- Draft count tracking with tier-based access control (`97ef8a9`)

### Changed
- Existing PRO subscribers upgraded to MAX tier; support features enhanced (`3c6077b`)
- Trial subscription tier set to MAX (`ae972c3`)
- Watch renewal supported for free users in cron (`31151fa`)

### Docs
- Env example updated with tier product IDs; pricing strategy doc added (`be1ea24`)

## [1.11.0] — 2026-06-02

### Added
- Health check endpoint at `/api/health` (`85194e5`)
- Batch email classification via a Redis buffer queue (`54048b6`)

### Changed
- Draft `MAX_OUTPUT_TOKENS` increased from 600 to 4096 to prevent length truncation (`c9ddea2`)
- Draft style mirroring expanded — emojis, expressiveness, capitalization, abbreviations, sign-offs (`cfed5a7`)
- Draft prompt uses natural human replies instead of bracket placeholders (`7dd9eb1`)
- GitHub repo resolution enhanced (`4985348`)

### Fixed
- Empty OpenAI response guarded to prevent a JSON parse crash (`6892e79`)
- Batch deduplicated by `message_id` to prevent ON CONFLICT error 21000 (`a4407c3`)
- GitHub global search fallback removed to prevent leaking unrelated public repos (`4b0dc47`)

## [1.10.0] — 2026-05-31

### Added
- Redis-buffered batch email inserts via BullMQ (`c1de8bc`)

### Changed
- Docker image size reduced ~82% (900MB → 160MB) with Alpine + in-process workers (`0eeb958`)
- `SubscriptionModal` redesigned; `media-src` added for Cloudinary (`30f925c`)

### Fixed
- Calendar timezone handling — DB timezone over ISO offset, FreeBusy cross-checked with `events.list` (`03dbfe6`)
- ISO 8601 interval format handled from the draft API (`7ae5ab7`)
- Regex character-class range bug in `timePart` extraction (`9d4d3b8`)
- Docker/Alpine build fixes — bash dependency, `oven/bun` image, `@bull-board` runtime copy (`f8cc787`, `a5e690c`, `dfed38a`)
- Instrumentation and workers restricted to the Node.js runtime (`80cbca2`)

## [1.9.0] — 2026-05-29

### Added
- Dashboard UI refreshed (`a05e47a`)

### Changed
- Background job processing migrated from Inngest to BullMQ (`5d3a9c9`)
- Bull Board auth hardened — rate limiting, timing-safe comparison, audit logging, min password length (`0198f83`, `77752fc`)

### Fixed
- 404 handled gracefully when messages are manually deleted by the user (`3cdea3b`)
- Unsubscribe shows "Message already deleted or moved" on 404; error field checked even on HTTP 200 (`e2db39f`, `f834a33`)
- BullMQ: keep last 50 completed jobs, increased `lockDuration`; `removeOnComplete` reverted to prevent Redis RDB bloat (`3f0909a`, `0743565`)

### Docs
- Inngest references updated to BullMQ across README, AGENTS.md, and `tags.ts` (`530852c`)

## [1.8.0] — 2026-05-27

### Added
- Daily Digest — schema and AI summary/action pipeline (`d045b57`)
- Daily digest backend with cron job and email template (`0cc4a05`)
- Digest UI pages with restructured sidebar (`ecdf778`)
- Message body retrieval and reply functionality in the digest section (`88657b7`)

### Changed
- Email tracking uses `isDone` instead of `is_read` (`71f24fc`)
- Google verification check added in OAuth (`78f69bf`)

### Fixed
- Digest preferences no longer auto-created on GET; default enabled state is false (`d0ec301`, `99e2ca3`)
- `supabase.ts` encryption handling corrected for non-empty strings (`b6705fb`)

### Security
- `ai_summary` and `ai_action` encrypted at rest (`92d3af0`)

## [1.7.0] — 2026-05-26

### Added
- GitHub integration for context fetching and issue retrieval in email drafts (`38188e1`)
- Notion integration with context fetching and relevant page extraction (`8ddb8ad`)
- HubSpotProvider enhanced with methods for fetching notes, tasks, and tickets (`c0130bd`)
- User deletion functionality in draft and model services with error handling (`5bf9e23`)
- Google verification email handling for history sync in email route (`216533e`)
- Gmail integration enhancement with client retrieval and quota limits in throttle.ts (`2e2eba0`)
- Caching for known repositories in GitHubProvider (`38fa502`)
- Stopword package integrated in GitHub and HubSpot providers (`cfe3b08`)

### Changed
- GitHubProvider simplified — removed router/scoring, uses Promise.allSettled + unified fetchWithTimeout (`ec11b54`)
- Unnecessary logging removed in GitHub and Notion providers; logging added in HubSpot (`a1c6cc0`)
- Reply generation rules clarified with explicit checks for missing information (`0f179fb`)
- Timeout duration increased for context fetching and guidance on missing information updated (`d96dfdf`)
- getLastSentMessageInThreadOutlook optimized by directly querying sent items (`205eb4e`)
- Condition updated to check for top pages in NotionProvider context fetching (`9ef69bd`)

### Docs
- Google API quota reference and rate limits for Gmail and Calendar APIs (`0032ee9`)

## [1.6.0] — 2026-05-24

### Added
- HubSpot integration with context fetching and UI components (`7751568`)
- Last message retrieval for email threads in Gmail and Outlook (`b52a087`)
- Email draft processing with user name integration and context formatting (`f6eb7a2`)
- Trial status response for users with active trials in subscription checks (`1732b3c`)
- Prompt engineering patterns skill to skills-lock.json (`ac70b48`)

### Changed
- Output token limit adjusted with guidelines for reply generation length (`188e2fb`)
- Output token limit increased; helper functions exported for better accessibility (`33b6411`)
- .agents/skills removed from tracking and added to .gitignore (`57a00a0`)

## [1.5.0] — 2026-05-21

### Added
- Reply functionality for Gmail and Outlook conversations with FollowUps UI integration (`4f08c2d`)

## [1.4.0] — 2026-05-20

### Added
- `NotSubscribedState` component using `premium.svg` with default "Go to Billing" link (`65ac44a`)
- Subscription gating on FollowUps, EmailStats (unsubscribe), and StorageAnalysis pages (`65ac44a`)
- `enabled` parameter on `useGetSentEmails`, `useGetUserEmailStats`, and `useGetFilteredEmails` hooks to skip API calls for unsubscribed users (`65ac44a`)

## [1.3.0] — 2026-05-19

### Added
- Throttling mechanism for API requests using Redis (`042f898`)

## [1.2.0] — 2026-05-18

### Added
- `reminder_sent_at` field to Subscription model for tracking reminder delivery (`63bc563`)
- Cache-Control header to improve caching strategy (`e77ac62`)
- FollowUps button text updated to indicate email client (`7e24134`)

### Changed
- next.config settings enhanced for image handling and headers (`7e24134`)
- Code structure refactored for improved readability and maintainability (`a5eb466`)

## [1.1.0] — 2026-05-16

### Added
- Follow-ups page showing sent emails awaiting replies (`ab72acd`)
- Changelog to document project updates and version history (`4d2681a`)

### Fixed
- Outlook ID handling updated to support multiple IDs in renewal process and various functions (`1042b19`, `a312e56`)

## [1.0.0] — 2026-05-15

### Added
- Watched folders functionality with Outlook integration (`b1d55b9`, `d4f1d6d`)
- Active folder data in Outlook subscription creation (`6080fb3`, `42a8f87`)
- Language selection to draft preferences, piped through draft creation (`5f2ad50`)
- Slack integration — OAuth flow, context provider, API routes, and UI (`7624a66`, `9505b98`, `e929b15`)
- Slack provider with search, context retrieval, and user connection check (`b5eea2f`, `d34b758`, `a627612`)

### Fixed
- Debug logs removed from Gmail and Outlook label correction processing (`0a9df2d`)
- Debug logs removed from SlackProvider fetchContext and buildQuery (`c1a2622`)
- Slack search parameters updated: count to 6, sort by score (`3f822a6`)
- Async handling for Slack token decryption (`51417be`)
- Layout adjustments for folder selection in WatchedFolderSelect (`d31fd06`)

### Changed
- activeFolder function corrected to filter and map folder data properly (`cc7e409`)

## [0.9.0] — 2026-05-10

### Added
- Storage analysis page: find and delete large emails by size and date range (`cb4ea3d`)
- ErrorState component replacing Alert in EmailStats and StorageAnalysis (`1736602`)
- PageTransition component for animated page transitions (`d5fce37`)
- AppSidebar animated active indicator with layout grouping (`1f45b71`)
- One-Click Cleanup feature image in README (`6bdf91d`)
- Badge UI component with variants (`468c4cc`)
- Pagination for email retrieval with nextPageToken and maxResults (`f126918`)
- DeleteOutlookMessage function and email deletion logic (`4386f28`)
- Outlook message archiving with enhanced filtering (`ab3dafb`)

### Fixed
- Date validation schema and error handling for date queries in email and stats routes (`e5f624f`)
- Audience URL in Gmail webhook now uses environment variable (`a7dbab9`)
- Syncing message clarifies inbox reference (`f51d7c4`)

### Changed
- Sidebar restructured with Cleanup section and refined navigation (`844ef81`)
- getGmailClient simplified: Redis caching and in-process token cache removed (`7e6cc15`)
- Code structure refactored for readability and maintainability (`d85b1c6`)

### Removed
- entity-extractor.ts file and associated OpenAI integration (`69db3d4`)
- User privacy settings and related API endpoints (`a6a3151`)

## [0.8.0] — 2026-05-01

### Added
- Auto-archive functionality for Gmail and Outlook messages (`644ef8d`)
- Archive rules management in API (`644ef8d`)
- Gmail historical data sync via API endpoint and React hook (`8352f8f`)
- Outlook email history sync and retrieval (`89e1741`)
- Read vs Unread component with API integration for 7-day stats (`1add533`)
- MostEmails component for tracking top email senders (`9d1cf11`)
- Date range picker on dashboard with component updates (`ef48839`)
- Skip processing for users not subscribed to archiving rules (`bf378bf`)

### Fixed
- Clutter component layout, loading states, and unsubscribe options (`ba8a08c`)
- Archive option alignment in EmailStats (`08fabd4`)
- Layout and responsiveness in EmailStats (`2fd7dde`)
- Login.svg added to public folder (`858d068`)
- Total days calculation for email metrics (`d627265`)
- Margin adjustments in Clutter and MostEmails components (`1df801b`)
- Take limits in stats API for clutter and top labels queries (`ad80594`)
- Greeting calculation optimized with useMemo (`076313b`)
- Dashboard greeting subtitles and LabelDistribution colors (`d99ef0e`)
- Time period references from month to week (`bbe0ba2`)
- Traffic data metrics and trend rendering (`58cd1ca`)

### Changed
- Debounced date handling in dashboard for performance (`cdcf65f`)
- Email count logic simplified, date range extended (`7104eea`)
- archiveMessages renamed to trashMessages with updated response (`161dda1`, `e46d3f2`)
- Archive flow simplified to button + duration selection (`07a0b8a`)
- TruncateLabel function limits domain display in EmailStats (`742bb23`)

### Removed
- MailsByDay component and associated data fetching (`5f5e99b`)

## [0.7.0] — 2026-04-20

### Added
- OpenAI agent for Gmail interaction and email drafting via Telegram (`2afb726`)
- HTML-to-text dependency and Telegram HTML formatting functions (`138ef88`, `6daf561`)
- Automated alerts for email categorization (`2412d76`)
- Global API rate limiting with dynamic response headers (`6f60135`)
- ioredis migration from Upstash Redis (`9a2e841`)
- MailsByDay component with time-saved metrics (`ea416fd`, `dda46bb`)
- Daily email statistics API integration (`aa90539`)

### Fixed
- Console logging for missing user token includes clerk user ID (`aae4390`)
- Email labeling logic refined, redundant conditions removed (`9082a08`)
- inngest downgraded to 3.54.0 for compatibility (`0add8bf`)

### Changed
- Agentic workflow optimized with compact search and increased buffer (`cd526f5`)
- Agentic loop token usage optimized via result compression (`de545d5`)
- OpenAI model updated from gpt-5.4-mini to gpt-5-mini (`c85c69a`)
- Font sizes increased in MailsByDay and LabelDistribution (`368d5bd`)
- Color scheme updated in MailsByDay (`ea416fd`)
- Take limits increased for clutter and top labels queries (`60285a1`)

## [0.6.0] — 2026-04-10

### Added
- HeatMap component for inbox traffic and focus time visualization (`782a693`)
- Clutter component with hooks for clutter data management (`7181044`)
- Stats route for email metrics and engagement analysis (`650c121`)
- EmailStats component and fetching hooks (`28318c`, `28218c5b`)
- Endpoint to fetch email statistics by domain (`e444a83`)
- Email unsubscribe functionality — link extraction, redirect handling (`7502d2c`, `0aa3e4a`, `661c55e`)
- Outlook mail event update and webhook integration (`c1f80c9`)
- Domain, is_read, and rawDomain fields in email_tracked model (`28618c2`, `27918c2`)
- Gmail API client with caching, message fetching, parsing, and drafting (`041d45b`)
- WelcomeDialog component for onboarding (`27123d03`)

### Fixed
- Gmail attachment ID rotation handled by falling back to first available (`0f04705`)
- Sender name and email assignment in Outlook mail processing (`306b810`)
- Email body snippet sanitization — HTML character escaping (`7dca648`)
- Various console logs removed from Gmail processing (`29618c2`)
- Truncation of email body for snippet in processing (`46f1365`)

### Changed
- HeatMap color scheme improved for clarity (`e280389`)
- LabelDistribution background colors updated (`e7482a2`)
- Clutter component styling: Avatar variant, gap, layout (`25518c2`, `25818c2`, `25918c2`)
- Domain encryption uses libsodium with deterministic nonce (`27218c2`, `26718c2`)
- Sidebar updated: "Mails" → "Unsubscribe", icon to Shredder (`27618c2`)
- Email classification enhanced with tag matching and category normalization (`26918c2`, `27018c2`)
- Classification rules refined for automated emails and response requirements (`287-292`)
- Sensitivity handling updated across processing functions (`293-295`)

## [0.5.0] — 2026-03-28

### Added
- Telegram integration for email notifications and management (`d62c197`)
- Quick reply options and draft notification for Telegram (`22a2d6b`, `22322d6b`)
- telegramPendingDraft table with unique constraint on chat_id (`cf24827`)
- Gmail draft update and send functions with OpenAI text corrections (`6e56303`)
- deleteGmailDraft function and route integration (`943a3d5`)
- checkAndForwardToTelegram with tagName support (`cb55260`)
- Forward important mails and draft confirmation fields to TelegramIntegration (`7dec72c`)
- Integration rules model with user_tokens relation (`32b56a4`)
- Telegram query processing function with routing (`08cd778`)
- sendTelegramMessage function for notifications (`1e98db5`)
- HTML escaping in handleTelegramQuery response (`36d4d0d`)
- Attachment handling in Gmail and Telegram messaging (`f1bc1b6`)
- Chat history management with Redis in handleTelegramQuery (`bc44cf0`)
- Feedback link in AppSidebar, "Delete Account" → "Danger Zone" (`ce27686`)

### Fixed
- Telegram webhook route matcher corrected (`fad99bf`, `e384764`)
- Response for unsubscribed users returns JSON (`e2db357`)
- Subscription check added before Telegram messages (`13518c2`)
- Rotating Gmail attachment IDs handled by fallback (`0f04705`)
- Debug logs removed from attachment retrieval (`14618c2`)

### Changed
- OpenAI model updated from gpt-5.4-mini to gpt-5-mini (`15818c2`)
- getModelTagsUser removed, tag references updated in email processing (`21818c2`)
- Logging enhanced in checkAndForwardToTelegram (`22518c2`)

## [0.4.0] — 2026-03-15

### Added
- Context engine with email entity extraction and Google Calendar integration (`6b900ee`)
- Draft context API and processing with context generation (`44c63e3`, `35544c63e3`)
- Outlook calendar integration for draft processing (`6e1c235`)
- getGmailMessageBody function for full email body retrieval (`a0d5d2f`)
- Email classification with response requirement in OpenAI (`33520cb591`)
- Sensitivity field in draft_preference model and related types (`295e3f8107`)
- Timezone support in draft preferences and processing (`324ef52390`, `32528e4db8`)
- "Read only" label for specific email categories (`3233281515`)
- Description field in tag model and UserTag (`3159eb4df8`, `3167c28f64`)
- User Gmail status retrieval with label settings integration (`18291a9318`)
- Development route for Microsoft OAuth token retrieval (`3267f78a10`)

### Fixed
- Timezone encoding in Google Calendar API requests (`342228fc73`)
- Google Calendar queries respect local timezone boundaries (`34380a8565`)
- Variable names corrected for token and email body in draft processing (`346afa537d`)
- GPT model deployment name corrected to gpt-5-mini (`314e04a14c`)

### Changed
- OpenAI classifier replaces model classification in email processing (`339178bc7f`)
- classifyEmail enhanced with available categories in prompt (`297fa7701f`)
- max_completion_tokens increased from 20 to 40 (`2981326e8e`)
- Label handling simplified, CATEGORY_UPDATES check removed (`2996636335`)
- classifyEmail simplified, unused generateEmailReply removed (`301e772795`)
- response_required handling removed from classification (`302f7134ef`)
- Email body extraction simplified — HTML handling removed (`30446f1365`)
- Full email body retrieved and truncated for snippet (`30589f06f1`)
- Classification rules updated for priority and semantic context (`30985c221f`, `3111ecbd84`)
- Category descriptions updated for clarity (`310aa5505e`)
- Conflict messaging shows all busy slots (`3282b102e2`)
- Calendar providers privacy menu item commented out (`33894cec2f`)

## [0.3.0] — 2026-03-05

### Added
- Microsoft Outlook integration — webhook, subscription management, email fetching (`395ae6b25f`, `39612cfec3`, `3976ff40a4`)
- Outlook email processing and label correction (`247bf8f329`, `246a6b453a`)
- Outlook watch and subscription renewal support (`3942f0defb`)
- Outlook preset field in tag model (`4241b10`)
- is_folder field in user_tokens model for folder categorization (`39278396a3`)
- UpdateFolderPreference component with folder messaging (`3916b38e5d`)
- Customer portal with payment history and subscription handling (`3662398a80`, `36970647df`)
- Billing component on billing page (`3674563646`)
- DodoPayments integration for payment processing (`37799b5c25`, `376c32dcea`)
- GitHub Actions workflow for production database migration (`379be0b175`)
- Initial database migration: user_tokens, tag, and related tables (`380f983618`)
- Gmail API history and message retrieval error handling (`371b039211`)

### Fixed
- Subscription query filters by next billing date and cancellation status (`375674518a`)
- activateWatch uses clerk_user_id instead of dodoSubscriptionId (`3834c884f3`)
- Default value of is_folder set to false (`382d804945`)
- Model deployment name corrected to gpt-4.1-mini (`372942c5c2`)
- /all route error handling and public API route inclusion (`37029ae093`)
- README updated with Outlook integration details (`381c07094e`)

### Changed
- Privacy settings description updated with link (`373cd4b1f8`)
- Rate limiting logic enhanced, identifier includes user ID (`374b1428f3`)
- Label mapping simplified in classifyEmail (`378485d9c8`)
- Email classification rules refined for finance and domain contexts (`458eecf663`)
- Font family updated in globals.css (`45237b240f`)

## [0.2.0] — 2026-02-14

### Added
- DodoPayments checkout session with country-based product selection (`42610866cf`, `4277c38929`, `428685284d`)
- Trial period (14 days) if not previously taken (`425a0573b5`)
- Subscription status display and cancel button in Billing (`5058638ef3`)
- Wallet balance retrieval in Billing component (`497173e256`)
- Subscription modal with 7-day free trial offer (`5342549fa5`)
- Reserved keywords validation for label names (`527a573e3b`)
- Dockerfile with multi-stage build and .dockerignore (`482de3b447`)
- Permissions modal and scope fetching logic (`516a1e33e6`)
- Custom label creation with description field (`43278fa0cb`, `431047f00a`)
- Email classification with axios integration (`4512db4b43`)
- Cron job endpoint for user deletion (`471cd07571`)
- Watch renewal endpoint for active subscriptions (`4691166314`)
- Refund processing endpoint with automated logic (`445e62bced`, `44618a02cf`)
- Login.svg asset (`4537aa1994`)
- API timeout increased to 120 seconds (`447068727d`)

### Fixed
- Subscription status handling extended in addSubscriptiontoDb (`5012c7ccf2`)
- User subscription check in Gmail webhook handler (`5000ee6cb1`)
- Hardcoded user check removed from addSubscriptiontoDb (`4987230c1c`)
- Wallet balance display reflects correct value (`496bea2462`)
- Checkbox and button disabled when user is unsubscribed (`5030862c80`)
- Timestamp fields updated to Timestamptz (`5076971d76`)
- Subscription queries ordered by updatedAt (`5081e7fda1`)
- Authorization header validation in Gmail webhook (`502afcfc6a`)
- Package vulnerabilities fixed (`494631fc9b`)
- Domain updated from neatmail.tech to neatmail.app in CSP (`4622902e61`)

### Changed
- TrackedEmail component layout, header, and sender formatting (`4789a0ddfa`, `479ca54a78`)
- README updated with Docker support, environment config (`481303f869`)
- Endpoint renamed from /create to /addTagtoUser (`483611ad62`)
- Query invalidation added for watch and tag mutations (`485365deb1`, `48659ecadd`)
- Tag names trimmed before duplicate check (`4876c04c26`)
- Thread processing logic updated for correct Redis key usage (`48897b7e20`)

## [0.1.0] — 2026-02-01

### Added
- Initial Next.js project setup with App Router and Hono API mount
- Clerk authentication integration with middleware in proxy.ts
- Prisma ORM with PostgreSQL — custom output path for generated client
- Redis-based sliding window rate limiter
- Gmail webhook handling with PubSub push notifications
- Gmail API watch management (activate, renew, deactivate)
- Email tracking model (email_tracked) with user and domain tracking
- Basic subscription management with DodoPayments
- User account deletion flow with watch deactivation
- Content-Security-Policy headers
- NeatMail Open Source License

### Fixed
- Thread processing logic and duplicate tag prevention
- Message processing with unmarkMessageProcessed function

### Security
- Authorization header validation for webhook endpoints
- Environment variable configuration for all secrets
- Content-Security-Policy for neatmail.app domain


