"use client";

import Billing from "@/components/Billing";
import CustomerPortal from "@/components/CustomerPortal";
import { MemberBillingNotice } from "@/components/MemberBillingNotice";
import { useGetTeam } from "@/features/organization/use-get-team";

const Page = () => {
  const { data, isLoading } = useGetTeam();

  return (
    <div className="w-full p-6 md:px-10">
      {isLoading ? (
        // Hold the frame until we know whether this user owns billing, so a
        // teammate never flashes the pricing UI before the managed notice.
        <div className="mx-auto max-w-lg py-16">
          <div className="h-72 animate-pulse rounded-xl bg-muted" />
        </div>
      ) : data?.role === "member" ? (
        <MemberBillingNotice
          adminEmail={data.admin.email}
          teamName={data.organization.name}
        />
      ) : (
        <div className="space-y-8">
          <h1 className="text-2xl font-semibold font-logo tracking-tight">
            Billing &amp; subscription
          </h1>
          <Billing />
          <CustomerPortal />
        </div>
      )}
    </div>
  );
};

export default Page;
