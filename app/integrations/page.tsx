import { TelegramCard } from "@/components/Integrations/Telegram/Card"
import { SlackCard } from "@/components/Integrations/Slack/Card"
import { ClerkOAuthIntegrations } from "./ClerkOAuthIntegrations"

const Page = () => {
  return (
    <div className="w-full p-4 space-y-4">
      <TelegramCard />
      <SlackCard />
      <ClerkOAuthIntegrations />
    </div>
  )
}

export default Page
