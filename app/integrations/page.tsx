import { TelegramCard } from "@/components/Integrations/Telegram/Card"
import { SlackCard } from "@/components/Integrations/Slack/Card"

const page = () => {
  return (
    <div className="w-full p-4 space-y-4">
        <TelegramCard/>
        {/* <SlackCard/> */}
    </div>
  )
}

export default page