import { TelegramCard } from "@/components/Integrations/Telegram/Card"
import { SlackCard } from "@/components/Integrations/Slack/Card"
import { ClerkOAuthIntegrations } from "./ClerkOAuthIntegrations"
import { IntegrationsGate } from "./IntegrationsGate"
import { PageHeader } from "@/components/PageHeader"

const Page = () => {
  return (
    <>
      <PageHeader title="Integrations" />
      <div className="w-full p-4 space-y-4">
        <IntegrationsGate>
          <TelegramCard />
          <SlackCard />
          <ClerkOAuthIntegrations />
        </IntegrationsGate>
      </div>
    </>
  )
}

export default Page
