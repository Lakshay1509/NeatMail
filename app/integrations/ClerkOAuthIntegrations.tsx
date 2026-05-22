"use client";

import { IntegrationCard } from "@/components/Integrations/Card";


const integrations = [
  {
    provider: "hubspot",
    label: "HubSpot",
    description:
      "Sync contacts and deal context into your email drafts.",
    iconUrl: "integrations/hubspot.svg"
  },
] as const;

export const ClerkOAuthIntegrations = () => {
  return integrations.map(({ provider, label, description, iconUrl }) => (
    <IntegrationCard
      key={provider}
      provider={provider}
      iconUrl={iconUrl}
      label={label}
      description={description}
    />
  ));
};
