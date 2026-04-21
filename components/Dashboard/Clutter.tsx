"use client";

import { useGetClutter } from "@/features/stats/use-get-clutter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUnsubscribeDomain } from "@/features/email/use-post-unsubscribe";
import Link from "next/link";

const Clutter = () => {
  const { data, isLoading, isError } = useGetClutter();
  const unsubscribeMutation = useUnsubscribeDomain();

  const handleUnsubscribe = (domain: string) => {
    unsubscribeMutation.mutateAsync({ domain: domain });
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-[24px] p-6 shadow-sm border border-gray-100 w-full">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2 mb-6" />
        <div className="space-y-4">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError) {
    return <div className="text-red-500">Failed to load clutter data.</div>;
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100 w-full ">
      <div className="flex justify-between items-start mb-6 space-x-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Top Clutter Sources
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Domains impacting your attention span
          </p>
        </div>
        <Link
          className="text-sm font-semibold text-gray-500 hover:text-gray-600 transition-colors pt-1 text-right"
          href="/unsubscribe"
        >
          View all
        </Link>
      </div>

      <div className="space-y-3">
        {data?.clutterData?.map((item) => (
          <div
            key={item.domain}
            className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 border border-gray-50 transition-colors"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
              <div className="flex min-w-0 flex-1 flex-col space-y-1">
                <span className="font-semibold text-gray-900 text-sm truncate">
                  {item.domain}
                </span>
                <span className="text-xs font-medium text-gray-500 mt-0.5">
                  {item.unreadCount} unread
                </span>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              disabled={unsubscribeMutation.isPending}
              onClick={() => handleUnsubscribe(item.rawDomain ?? "")}
              className="shrink-0 bg-gray-200/50 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg px-4"
            >
              Unsubscribe
            </Button>
          </div>
        ))}
        {(!data?.clutterData || data.clutterData.length === 0) && (
          <div className="text-sm text-center text-gray-500 py-6">
            No clutter sources found.
          </div>
        )}
      </div>
    </div>
  );
};

export default Clutter;
