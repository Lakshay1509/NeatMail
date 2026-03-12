"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetUserCustomerPortal } from "@/features/checkout/use-get-customer-portal";
import Image from "next/image";

export const CustomerPortal = () => {
  const { data, isLoading } = useGetUserCustomerPortal();

  const handleManage = () => {
    if (data?.data) {
      window.open(data.data, "_blank");
    }
  };

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-1.5">
          Payment and billing is managed by{" "}
          <Image
            src="/dodo.svg"
            alt="Dodo Payments"
            width={120}
            height={20}
            className="inline-block shrink-0"
          />
        </p>
        <Button
          size="sm"
          onClick={handleManage}
          disabled={isLoading || !data?.data}
          className="gap-1.5 text-xs font-semibold tracking-widest uppercase w-full sm:w-auto"
        >
          Manage
          <ExternalLink className="size-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default CustomerPortal;
