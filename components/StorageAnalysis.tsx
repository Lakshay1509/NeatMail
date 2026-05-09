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
import { ArrowUpDown, Loader2 } from "lucide-react";
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
import { useGetFilteredEmails } from "@/features/email/use-get-filtered";
import { useDeleteMessageMutation } from "@/features/email/use-post-delete-message";
import { subMonths } from "date-fns";
import { DateRange } from "react-day-picker";
import { DatePickerWithRange } from "./DatePickerWithRange";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type EmailRow = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  sizeEstimate: number;
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const formatTime = (date: string): string => {
  const formatted = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));

  return formatted;
};

const extractName = (from: string): string => {
  const match = from.match(/^"?(.*?)"?\s*</);
  if (match && match[1].trim()) return match[1].trim();
  const emailMatch = from.match(/<([^>]+)>/);
  if (emailMatch) return emailMatch[1];
  return from;
};

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
};

const headerButtonClass =
  "-ml-4 flex items-center gap-1 text-xs tracking-wider text-muted-foreground/60 hover:bg-transparent";

const StorageAnalysis = () => {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "sizeEstimate", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [globalFilter, setGlobalFilter] = React.useState("");

  const [date, setDate] = React.useState<DateRange | undefined>({
    from: subMonths(new Date(), 12),
    to: new Date(),
  });
  const [debouncedDate, setDebouncedDate] = React.useState<
    DateRange | undefined
  >(date);
  const [selectedSize, setSelectedSize] = React.useState<number>(52428800);

  const sizeOptions = [
    { label: "1 MB", value: 1048576 },
    { label: "10 MB", value: 10485760 },
    { label: "25 MB", value: 26214400 },
    { label: "50 MB", value: 52428800 },
    { label: "100 MB", value: 104857600 },
    { label: "500 MB", value: 524288000 },
    { label: "1 GB", value: 1073741824 },
    { label: ">1 GB", value: 1073741825 },
  ];

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedDate(date);
    }, 500);
    return () => clearTimeout(handler);
  }, [date]);

  const after = debouncedDate?.from?.toISOString();
  const before = debouncedDate?.to?.toISOString();

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useGetFilteredEmails(after, before, selectedSize, 100);

  const rows = React.useMemo<EmailRow[]>(
    () => data?.pages.flatMap((page) => page.emails ?? []) ?? [],
    [data],
  );

  const deleteMutation = useDeleteMessageMutation();

  const columns = React.useMemo<ColumnDef<EmailRow>[]>(
    () => [
      {
        accessorKey: "subject",
        meta: { thClass: "w-[40%]" },
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
          <div className="flex flex-col gap-0.5">
            <span
              className="font-medium text-foreground truncate"
              title={row.original.subject}
            >
              {truncate(row.original.subject || "No subject", 60)}
            </span>
            {row.original.snippet && (
              <span
                className="text-xs text-muted-foreground/70 truncate"
                title={row.original.snippet}
              >
                {truncate(row.original.snippet, 50)}
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "from",
        meta: { thClass: "w-[30%]" },
        header: ({ column }) => (
          <Button
            variant="ghost"
            className={headerButtonClass}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            From
            <ArrowUpDown className="size-3" />
          </Button>
        ),

        cell: ({ row }) => (
          <span
            className="text-sm text-muted-foreground truncate"
            title={row.original.from}
          >
            {extractName(row.original.from)}
          </span>
        ),
      },
      {
        accessorKey: "date",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className={headerButtonClass}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Date
            <ArrowUpDown className="size-3" />
          </Button>
        ),

        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground tabular-nums">
            {formatTime(row.original.date)}
          </span>
        ),
      },
      {
        accessorKey: "sizeEstimate",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className={headerButtonClass}
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Size
            <ArrowUpDown className="size-3" />
          </Button>
        ),

        cell: ({ row }) => {
          const bytes = row.original.sizeEstimate;
          const mb = bytes / (1024 * 1024);
          const isLarge = mb > 100;
          return (
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-xs tabular-nums ${
                isLarge
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {formatBytes(bytes)}
            </span>
          );
        },
      },
      {
        id: "actions",
        meta: { thClass: "w-[100px]" },
        header: () => <span className="text-xs text-muted-foreground/60">Actions</span>,
        cell: ({ row }) => {
          const isDeleting =
            deleteMutation.isPending &&
            deleteMutation.variables?.messageId === row.original.id;
          return (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                deleteMutation.mutate({
                  messageId: row.original.id,
                });
              }}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          );
        },
      },
    ],
    [deleteMutation],
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
      const from = String(row.getValue("from")).toLowerCase();
      const search = String(filterValue).toLowerCase();
      return subject.includes(search) || from.includes(search);
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
      <Alert variant="destructive">
        <AlertTitle>Unable to load emails</AlertTitle>
        <AlertDescription>
          Please refresh the page and try again.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Input
          placeholder="Search by subject or sender..."
          value={globalFilter ?? ""}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex flex-col md:flex-row md:justify-center md:items-center gap-4">
          <Select
            value={selectedSize.toString()}
            onValueChange={(value) => setSelectedSize(Number(value))}
          >
            <SelectTrigger className="max-w-[180px]">
              <SelectValue placeholder="Select size" />
            </SelectTrigger>
            <SelectContent>
              {sizeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DatePickerWithRange date={date} setDate={setDate} isStorage />
        </div>
      </div>

      <div>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const thClass =
                    (
                      header.column.columnDef.meta as
                        | { thClass?: string }
                        | undefined
                    )?.thClass ?? "";
                  return (
                    <TableHead key={header.id} className={thClass}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
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
                  {row.getVisibleCells().map((cell) => {
                    const thClass =
                      (
                        cell.column.columnDef.meta as
                          | { thClass?: string }
                          | undefined
                      )?.thClass ?? "";
                    const cellClass = `py-4 border-b border-border/40 ${thClass}`;
                    return (
                      <TableCell key={cell.id} className={cellClass}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No emails match the current filters.
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

export default StorageAnalysis;
