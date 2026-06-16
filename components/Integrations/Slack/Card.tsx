"use client";

import { useDeleteSlackIntegration } from "@/features/slack/use-delete-slack";
import { useGetSlackEnabled } from "@/features/slack/use-get-slack-enabled";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import Image from "next/image";
import { useEffect } from "react";
import posthog from "posthog-js";

export const SlackCard = () => {
  const { data, isLoading, isError } = useGetSlackEnabled();
  const mutation = useDeleteSlackIntegration();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slack = params.get("slack");
    if (slack === "connected") {
      toast.success("Slack connected successfully");
    } else if (slack === "error") {
      const reason = params.get("reason");
      toast.error(reason ? `Slack connection failed: ${reason}` : "Slack connection failed");
    }
    if (params.has("slack")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("slack");
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const handleClickDelete = () => {
    posthog.capture("integration_disconnected", { provider: "slack" });
    mutation.mutateAsync();
  };

  const handleClickEnable = async () => {
    posthog.capture("integration_connected", { provider: "slack" });
    toast.info("Redirecting to Slack for authorization...");
    window.location.href = "/api/slack/authorize";
  };

  return (
    <div className="flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm shadow-black/5 w-full max-w-full">
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center space-x-4">
          <Image
            src="/integrations/slack.svg"
            alt="slack"
            width={40}
            height={40}
          />
          <div>
            <h3 className="font-semibold leading-none tracking-tight">Slack</h3>
          </div>
        </div>
        <Switch
          checked={data?.enabled ?? false}
          disabled={isLoading || mutation.isPending}
          onCheckedChange={(checked) => {
            if (checked) {
              handleClickEnable();
            } else {
              handleClickDelete();
            }
          }}
        />
      </div>
      <div className="px-6 pb-6 text-sm text-muted-foreground">
        Connect Slack to pull relevant conversation context into your drafts.
      </div>
    </div>
  );
};
