import { TelegramCard } from "@/components/Integrations/Telegram/Card"
import { SlackCard } from "@/components/Integrations/Slack/Card"
import { ClerkOAuthIntegrations } from "./ClerkOAuthIntegrations"
import { PageHeader } from "@/components/PageHeader"

// Cards render for everyone; telegram.ts/slack.ts refuse FREE callers server-side, which lib/hono turns into the upsell modal.
const Page = () => {
  return (
    <>
      <PageHeader title="Integrations" />
      <div className="w-full p-4 space-y-4">
        <TelegramCard />
        <SlackCard />
        <ClerkOAuthIntegrations />
      </div>
    </>
  )
}

export default Page
