# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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


