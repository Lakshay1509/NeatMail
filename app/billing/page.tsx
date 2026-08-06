"use client";

import Billing from "@/components/Billing";
import CustomerPortal from "@/components/CustomerPortal";
import { MemberBillingNotice } from "@/components/MemberBillingNotice";
import { PageHeader } from "@/components/PageHeader";
import { useGetTeam } from "@/features/organization/use-get-team";

const Page = () => {
  const { data, isLoading } = useGetTeam();

  return (
    <>
      {/* The page's own <h1> moved into the shared header; the strapline stays
          in the body, where it only applies to the billing-owner view. */}
      <PageHeader title="Billing & subscription" />
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
            <p className="text-sm text-muted-foreground">
              Manage your plan, seats, and payment details.
            </p>
            <Billing />
            <CustomerPortal />
          </div>
        )}
      </div>
    </>
  );
};

export default Page;
