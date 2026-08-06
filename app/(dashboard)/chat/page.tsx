import { ChatPage } from "@/components/chat/ChatPage"
import { PageHeader } from "@/components/PageHeader"

export default function Chat() {
  return (
    <>
      {/* No title — ChatPage owns its own top bar. The untitled header is
          mobile-only and exists purely to keep the sidebar reachable. */}
      <PageHeader />
      {/* Pure flex fill, no viewport math: the header (when present) takes its
          height first and the chat gets the rest. */}
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#f6f5f4]">
        <ChatPage />
      </div>
    </>
  )
}
