'use client'

import { useDeleteSlackIntegration } from "@/features/slack/use-delete-slack";
import { useGetSlackEnabled } from "@/features/slack/use-get-slack-enabled"
import { Switch } from "@/components/ui/switch"
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import Image from "next/image";



export const SlackCard = () => {
  const { data, isLoading, isError } = useGetSlackEnabled();
  const mutation = useDeleteSlackIntegration();
  const { user, isLoaded } = useUser();

  const handleClickDelete = () => {
    mutation.mutateAsync()
  }

  const handleClickEnable = async () => {
  if (!user) return;
  try {
    toast.info("Redirecting to Slack for authorization...");
    const externalAccount = await user.createExternalAccount({
      strategy: "oauth_slack",
      redirectUrl: window.location.href,
    });

    // Clerk gives you the OAuth redirect URL here
    const redirectUrl = externalAccount.verification?.externalVerificationRedirectURL;
    if (redirectUrl) {
      window.location.href = redirectUrl.href;
    } else {
      toast.error("Could not get Slack authorization URL.");
    }
  } catch (error: any) {
    console.error("Slack connect error:", error);
    const message = error?.errors?.[0]?.message || error?.message || "Unknown error";
    toast.error(`Failed to connect Slack: ${message}`);
  }
};

  if (!isLoaded) return null;

  return (
    <div className="flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm shadow-black/5 w-full max-w-full">
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center space-x-4">
          <Image src="/integrations/slack.svg" alt="slack" width={40} height={40}/>
          <div>
            <h3 className="font-semibold leading-none tracking-tight">Slack</h3>
          </div>
        </div>
        <Switch
          checked={data?.enabled ?? false}
          disabled={isLoading || mutation.isPending || !isLoaded}
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
       Connect Slack to pull relevant conversation context into your drafts.
      </div>
    </div>
  )
}
