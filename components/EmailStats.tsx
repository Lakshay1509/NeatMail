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
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type EmailStatsRow = {
  domain: string | null;
  total: number;
  read_count: number;
  unread_count: number;
  unread_percentage: number;
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
  className: string;
}) => {
  const safePercentage = clampPercentage(percentage);

  return (
    <div className="flex min-w-40 items-center gap-3">
      <div className="bg-muted h-2 w-full rounded-full">
        <div
          className={`h-2 rounded-full transition-all ${className}`}
          style={{ width: `${safePercentage}%` }}
        />
      </div>
      <span className="text-muted-foreground w-10 text-right text-xs tabular-nums sm:text-sm">
        {formatPercentage(safePercentage)}
      </span>
    </div>
  );
};

const EmailStats = () => {
  const { data, isLoading, isError } = useGetUserEmailStats();
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "total", desc: true },
  ]);
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([]);

  const rows = React.useMemo(() => normalizeRows(data), [data]);

  const columns = React.useMemo<ColumnDef<EmailStatsRow>[]>(
    () => [
      {
        accessorKey: "domain",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="h-8 px-0"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Domain
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-medium">{getDomainLabel(row.original.domain)}</span>
        ),
        sortingFn: "alphanumeric",
      },
      {
        accessorKey: "total",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="h-8 px-0"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Emails
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.total}</span>
        ),
      },
      {
        id: "read",
        accessorFn: (row) => getReadPercentage(row),
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="h-8 px-0"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Read
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <ProgressBar
            percentage={getReadPercentage(row.original)}
            className="bg-primary/60"
          />
        ),
      },
      {
        id: "unread",
        accessorFn: (row) => getUnreadPercentage(row),
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="h-8 px-0"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Unread
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <ProgressBar
            percentage={getUnreadPercentage(row.original)}
            className="bg-primary"
          />
        ),
      },
    ],
    []
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
      <div className="rounded-lg border">
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

  if (rows.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border p-6 text-sm">
        No email statistics available yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <div className="border-b p-4">
        <Input
          placeholder="Filter domains..."
          value={(table.getColumn("domain")?.getFilterValue() as string) ?? ""}
          onChange={(event) =>
            table.getColumn("domain")?.setFilterValue(event.target.value)
          }
          className="max-w-sm"
        />
      </div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={
                    header.column.id === "total"
                      ? "w-28"
                      : header.column.id === "read" || header.column.id === "unread"
                        ? "min-w-52"
                        : undefined
                  }
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length > 0 ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No matching domains.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default EmailStats;