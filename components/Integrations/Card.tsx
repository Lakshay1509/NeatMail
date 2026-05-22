"use client";

import { useGetIntegrationStatus } from "@/features/integrations/use-get-integration-status";
import { useDisableIntegration } from "@/features/integrations/use-disable-integration";
import { Switch } from "@/components/ui/switch";
import { useUser, useReverification } from "@clerk/nextjs"; 
import type { OAuthStrategy, CreateExternalAccountParams } from "@clerk/shared/types"; 
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Image from "next/image";
import { useEffect, type ReactNode } from "react";

type IntegrationCardProps = {
  provider: string;
  iconUrl: string;
  label: string;
  description: string;
  children?: ReactNode;
};

export const IntegrationCard = ({
  provider,
  iconUrl,
  label,
  description,
  children,
}: IntegrationCardProps) => {
  const { data, isLoading } = useGetIntegrationStatus(provider);
  const { mutate: disable, isPending } = useDisableIntegration(provider);
  const { user } = useUser();
  const router = useRouter();

  
  const createExternalAccount = useReverification(
    (params: CreateExternalAccountParams) => user?.createExternalAccount(params),
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get(provider);
    if (status === "connected") {
      toast.success(`${label} connected successfully`);
    } else if (status === "error") {
      const reason = params.get("reason");
      toast.error(
        reason
          ? `${label} connection failed: ${reason}`
          : `${label} connection failed`,
      );
    }
    if (params.has(provider)) {
      const url = new URL(window.location.href);
      url.searchParams.delete(provider);
      url.searchParams.delete("reason");
      window.history.replaceState({}, "", url.toString());
    }
  }, [provider, label]);

  const handleEnable = async () => {
    if (!user) return;

    try {
      toast.info(`Redirecting to ${label} for authorization...`);

      const res = await createExternalAccount({
        strategy: `oauth_${provider}` as OAuthStrategy,
        redirectUrl: `/integrations?${provider}=connected`,
      });

      
      if (res?.verification?.externalVerificationRedirectURL) {
        router.push(res.verification.externalVerificationRedirectURL.href);
      }
    } catch (err) {
      toast.error(`Failed to connect ${label}`);
      console.error(err);
    }
  };

  const handleDisable = () => {
    disable();
  };

  const enabled = data?.enabled ?? false;

  return (
    <div className="flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm shadow-black/5 w-full max-w-full">
      <div className="flex items-center justify-between p-6">
        <div className="flex items-center space-x-4">
          <Image src={iconUrl} alt={provider} width={40} height={40} />
          <div>
            <h3 className="font-semibold leading-none tracking-tight">{label}</h3>
          </div>
        </div>
        <Switch
          checked={enabled}
          disabled={isLoading || isPending}
          onCheckedChange={(checked) => {
            if (checked) {
              handleEnable();
            } else {
              handleDisable();
            }
          }}
        />
      </div>
      <div className="px-6 pb-6 text-sm text-muted-foreground">{description}</div>
      {enabled && children && (
        <div className="px-6 pb-6 border-t pt-6">{children}</div>
      )}
    </div>
  );
};