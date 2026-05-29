"use client";

import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import { useGetMostEmails } from "@/features/stats/use-get-mostEmails";

const MostEmails = ({ from, to }: { from?: string; to?: string }) => {
  const { data, isLoading, isError } = useGetMostEmails(from, to);
  

  const maxUnread = useMemo(() => {
    if (!data?.mostEmailsData) return 1;
    return Math.max(...data.mostEmailsData.map((d) => d.count || 0), 1);
  }, [data]);

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-6 w-full min-h-[300px]">
        <Skeleton className="h-6 w-1/2 mb-8" />
        <div className="flex justify-between mb-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-12" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-8 w-5/6" />
        </div>
      </div>
    );
  }

  if (isError) {
    return <div className="bg-card rounded-lg border p-6 text-muted-foreground">Failed to load sender data.</div>;
  }

  return (
    <div className="bg-card rounded-lg border p-6 w-full h-full flex flex-col">
      <h2 className="text-lg font-bold text-card-foreground mb-1">
        Top Email Senders
      </h2>
      <p className="text-sm text-muted-foreground mb-8">
        Your most active incoming email sources
      </p>

      <div className="flex justify-between items-center text-sm text-muted-foreground font-medium mb-4">
        <span>Sender</span>
        <span>Emails</span>
      </div>

      <div className="space-y-3">
        {data?.mostEmailsData?.map((item) => {
          const percentage = Math.max(10, ((item.count || 0) / maxUnread) * 100);

          return (
            <div
              key={item.domain}
              className="group flex items-center justify-between"
            >
              <div className="relative flex-1 min-w-0 mr-4">
                <div
                  className="absolute inset-0 bg-accent rounded-md transition-all duration-500 ease-in-out"
                  style={{ width: `${percentage}%` }}
                />
                <div className="relative px-3 py-1.5 text-sm text-card-foreground truncate font-medium">
                  {item.domain}
                </div>
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <span className="text-sm text-muted-foreground font-medium w-8 text-right">
                  {item.count}
                </span>
              </div>
            </div>
          );
        })}

        {(!data?.mostEmailsData || data.mostEmailsData.length === 0) && (
          <div className="text-sm text-center text-muted-foreground py-6">
            No senders found
          </div>
        )}
      </div>

      <Link
        href="/unsubscribe"
        className="w-full mt-4 md:mt-auto flex items-center justify-center py-2 bg-secondary hover:bg-secondary/80 border rounded-lg text-sm font-semibold text-card-foreground transition-colors"
      >
        <ChevronDown className="w-4 h-4 mr-2" />
        Manage sources
      </Link>
    </div>
  );
};

export default MostEmails;
