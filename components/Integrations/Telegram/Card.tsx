'use client'

import { useDeleteTelegramIntegration } from "@/features/telegram/use-delete-telegram";
import { useGetTelegramEnabled } from "@/features/telegram/use-get-telegram-enabled"
import { Switch } from "@/components/ui/switch"
import { useUser } from "@clerk/nextjs";
import Rules from "./Rules";

const TelegramIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.888-.662 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
  </svg>
)

export const TelegramCard = () => {

    const {data,isLoading,isError} = useGetTelegramEnabled();
    const mutation = useDeleteTelegramIntegration()
    const { user, isLoaded } = useUser();

    const handleClickDelete = ()=>{
        mutation.mutateAsync()
    }

    const handleClickEnable = () =>{
        window.open(`https://t.me/NeatMail_Bot?start=${user?.id}`,"_blank")

        
    }

  return (
    <div className="flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm shadow-black/5 w-full max-w-full">
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center space-x-4">
          <TelegramIcon className="w-10 h-10 text-[#2AABEE]" />
          <div>
            <h3 className="font-semibold leading-none tracking-tight">Telegram</h3>
          </div>
        </div>
        <Switch 
            checked={data?.enabled ?? false} 
            disabled={isLoading || mutation.isPending}
            onCheckedChange={(checked) => {
                if (checked) {
                    handleClickEnable()
                } else {
                    handleClickDelete()
                }
            }}
        />
      </div>
      <div className="px-6 pb-6 text-sm text-muted-foreground">
        Enable Telegram integration to receive instant notifications and manage alerts directly in your chats.
      </div>
      {data?.enabled && (
        <div className="px-6 pb-6 border-t pt-6">
          <Rules />
        </div>
      )}
    </div>
  )
}
