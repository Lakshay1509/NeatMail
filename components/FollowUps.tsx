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
import { ArrowUpDown, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetSentEmails } from "@/features/email/use-get-sent-emails";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";

type SentEmailRow = {
  id: string;
  threadId: string;
  subject: string;
  to: string;
  date: string;
  is_gmail: boolean;
};

const formatDate = (date: string): string =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));

const daysSince = (date: string): { text: string; days: number } => {
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return { text: "Today", days: 0 };
  return { text: `${days} day${days === 1 ? "" : "s"}`, days };
};

const waitingPillColor = (days: number): string => {
  if (days <= 3) return "bg-yellow-600/80 text-white";
  if (days <= 7) return "bg-orange-600/80 text-white";
  if (days <= 14) return "bg-red-700/80 text-white";
  return "bg-red-900/80 text-white";
};

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
};

const headerButtonClass =
  "-ml-4 flex items-center gap-1 text-xs tracking-wider text-muted-foreground/60 hover:bg-transparent";

const FollowUps = () => {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "date", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [olderThan, setOlderThan] = React.useState("7");

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useGetSentEmails(20, parseInt(olderThan));


  const rows = React.useMemo<SentEmailRow[]>(
    () =>
      data?.pages.flatMap((p) =>
        p.data.map((d) => ({ ...d, is_gmail: p.is_gmail })),
      ) ?? [],
    [data],
  );

  const columns = React.useMemo<ColumnDef<SentEmailRow>[]>(
    () => [
      {
        accessorKey: "subject",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className={headerButtonClass}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Subject
            <ArrowUpDown className="size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span
            className="font-medium text-foreground truncate block max-w-[400px]"
            title={row.original.subject}
          >
            {truncate(row.original.subject || "No subject", 80)}
          </span>
        ),
      },
      {
        accessorKey: "to",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className={headerButtonClass}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            To
            <ArrowUpDown className="size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span
            className="text-sm text-muted-foreground truncate block max-w-[300px]"
            title={row.original.to}
          >
            {row.original.to || "No recipient"}
          </span>
        ),
      },
      {
        id: "waiting",
        header: () => (
          <span className="text-xs tracking-wider text-muted-foreground/60">
            Waiting
          </span>
        ),
        cell: ({ row }) => {
          const { text, days } = daysSince(row.original.date);
          return (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${waitingPillColor(days)}`}
            >
              {text}
            </span>
          );
        },
      },
      {
        accessorKey: "date",
        sortingFn: (a, b) => new Date(a.original.date).getTime() - new Date(b.original.date).getTime(),
        header: ({ column }) => (
          <Button
            variant="ghost"
            className={headerButtonClass}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Sent Date
            <ArrowUpDown className="size-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground tabular-nums">
            {formatDate(row.original.date)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => (
          <span className="text-xs tracking-wider text-muted-foreground/60">
            Actions
          </span>
        ),
        cell: ({ row }) => {
          const { id, threadId, is_gmail } = row.original;
          const href = is_gmail
            ? `https://mail.google.com/mail/u/0/#sent/${threadId}`
            : `https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(id)}`;

          return (
            <Button variant="outline" size="sm" asChild>
              <a href={href} target="_blank" rel="noopener noreferrer">
                View Details
                <ExternalLink className="ml-1.5 size-3" />
              </a>
            </Button>
          );
        },
      },
      
    ],
    [],
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
      globalFilter,
    },
    globalFilterFn: (row, _columnId, filterValue) => {
      const subject = String(row.getValue("subject")).toLowerCase();
      const to = String(row.getValue("to")).toLowerCase();
      const search = String(filterValue).toLowerCase();
      return subject.includes(search) || to.includes(search);
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        title="Unable to load sent emails"
        description="Please refresh the page and try again."
        width={300}
        height={300}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row md:items-center items-start gap-3 justify-between">
        <Input
          placeholder="Search by subject or recipient..."
          value={globalFilter ?? ""}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex flex-row items-center justify-start md:justify-center space-x-2">
          <div className="text-sm">Older Than :</div>
        <Select value={olderThan} onValueChange={setOlderThan}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Select range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 1 days</SelectItem>
            <SelectItem value="3">Last 3 days</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="21">Last 21 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
        </div>
      </div>

      <div>
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
                  className="transition-colors hover:bg-muted/40"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="py-4 border-b border-border/40"
                    >
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
                  className="text-center"
                >
                  <EmptyState
                    title="No sent emails"
                    description="No sent emails found older than 14 days."
                    width={240}
                    height={240}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </div>
  );
};

export default FollowUps;
