"use client";

import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetUserEmailStats } from "@/features/email/use-get-stats";
import { useUnsubscribeDomain } from "@/features/email/use-post-unsubscribe";
import { useArchiveMutation } from "@/features/email/use-post-archive";

type EmailStatsRow = {
  domain: string | null;
  rawDomain: string | null;
  total: number;
  read_count: number;
  unread_count: number;
  unread_percentage: number;
  is_archived: boolean;
  archive_after_days: number | null;
};

const clampPercentage = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
};

const formatPercentage = (value: number): string => {
  return `${Math.round(clampPercentage(value))}%`;
};

const getReadPercentage = (row: EmailStatsRow): number => {
  if (!row.total || row.total <= 0) return 0;
  return clampPercentage((row.read_count / row.total) * 100);
};

const getDomainLabel = (domain: string | null): string => {
  return domain?.trim() || "Unknown sender";
};

const truncateLabel = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
};

const normalizeRows = (value: unknown): EmailStatsRow[] => {
  if (Array.isArray(value)) {
    return value as EmailStatsRow[];
  }

  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return (value as { data: EmailStatsRow[] }).data;
  }

  return [];
};

const getUnreadPercentage = (row: EmailStatsRow): number => {
  return clampPercentage(row.unread_percentage);
};

const ProgressBar = ({
  percentage,
  className,
}: {
  percentage: number;
  className?: string;
}) => {
  const safePercentage = clampPercentage(percentage);

  return (
    <div className="flex w-30 items-center gap-2 sm:w-50">
      <div className="bg-secondary h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full bg-black transition-all ${className || ""}`}
          style={{ width: `${safePercentage}%` }}
        />
      </div>
      <span className="text-muted-foreground w-12 text-right text-sm font-medium tabular-nums">
        {formatPercentage(safePercentage)}
      </span>
    </div>
  );
};

// Outside EmailStats component
const ActionsCell = ({
  domain,
  isArchived,
  archiveAfterDays,
  globalDuration,
}: {
  domain: string;
  isArchived: boolean;
  archiveAfterDays: number | null;
  globalDuration: 30 | 60;
}) => {
  const unsubscribeMutation = useUnsubscribeDomain();
  const archiveAfterMutation = useArchiveMutation();

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={archiveAfterMutation.isPending}
        className="w-32"
        onClick={(e) => {
          e.stopPropagation();
          archiveAfterMutation.mutate({
            domain,
            enabled: !isArchived,
            duration: !isArchived ? globalDuration : 30,
          });
        }}
      >
        {isArchived ? `Un-archive (${archiveAfterDays || globalDuration}d)` : "Archive"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={unsubscribeMutation.isPending}
        onClick={(e) => {
          e.stopPropagation();
          unsubscribeMutation.mutate(
            { domain },
            {
              onSuccess: (data: any) => {
                if (data?.requiresRedirect && data?.redirectUrl) {
                  window.open(data.redirectUrl, "_blank");
                }
              },
            },
          );
        }}
      >
        Unsubscribe
      </Button>
    </div>
  );
};

const EmailStats = () => {
  const { data, isLoading, isError } = useGetUserEmailStats();
  const unsubscribeMutation = useUnsubscribeDomain();
  const archiveAfterMutation = useArchiveMutation();
  const [archiveDuration, setArchiveDuration] = React.useState<30 | 60>(30);
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "total", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );

  const rows = React.useMemo(() => normalizeRows(data), [data]);

  const columns = React.useMemo<ColumnDef<EmailStatsRow>[]>(
    () => [
      {
        accessorKey: "domain",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="-ml-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            From
          </Button>
        ),
        cell: ({ row }) => (
          <div
            className="font-medium "
            title={getDomainLabel(row.original.domain)}
          >
            {truncateLabel(getDomainLabel(row.original.domain), 22)}
          </div>
        ),
        sortingFn: "alphanumeric",
      },
      {
        accessorKey: "total",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="-ml-4  text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Emails
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {row.original.total}
          </span>
        ),
      },
      {
        id: "read",
        accessorFn: (row) => getReadPercentage(row),
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="-ml-4  text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Read
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <ProgressBar
            percentage={getReadPercentage(row.original)}
            className="bg-black"
          />
        ),
      },
      {
        id: "unread",
        accessorFn: (row) => getUnreadPercentage(row),
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="-ml-4  text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Unread
            <ArrowUpDown className="ml-2 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <ProgressBar
            percentage={getUnreadPercentage(row.original)}
            className="bg-black"
          />
        ),
      },
      {
        id: "actions",
        header: () => (
          <Button
            variant="ghost"
            className="-ml-4  text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent"
          >
            Actions
          </Button>
        ),
        cell: ({ row }) => {
          const domain = row.original.rawDomain;
          if (!domain) return null;
          return (
            <ActionsCell
              domain={domain}
              isArchived={row.original.is_archived}
              archiveAfterDays={row.original.archive_after_days}
              globalDuration={archiveDuration}
            />
          );
        },
      },
    ],
    [unsubscribeMutation, archiveDuration],
  );

  const table = useReactTable({
    data: rows,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnFilters,
    },
  });

  if (isLoading) {
    return (
      <div className="">
        <div className="space-y-3 p-4">
          {[...Array(6)].map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unable to load email stats</AlertTitle>
        <AlertDescription>
          Please refresh the page and try again.
        </AlertDescription>
      </Alert>
    );
  }

  if (rows.length === 0 && !isLoading) {
    return (
      <div className="text-muted-foreground rounded-lg border p-6 text-sm">
        No email statistics available yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex-col md:flex md:flex-row items-center justify-between px-2 space-y-2">
        <Input
          placeholder="Filter domains..."
          value={(table.getColumn("domain")?.getFilterValue() as string) ?? ""}
          onChange={(event) =>
            table.getColumn("domain")?.setFilterValue(event.target.value)
          }
          className="max-w-sm"
        />
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground text-nowrap ">
            Archive after:
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-30 justify-between" >
                {archiveDuration} Days
                <ChevronRight className="ml-2 h-4 w-4 opacity-50 rotate-90" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setArchiveDuration(30)}>
                30 Days
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setArchiveDuration(60)}>
                60 Days
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="group transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="align-middle">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No matching domains.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default EmailStats;
