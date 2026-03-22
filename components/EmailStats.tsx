"use client"

import * as React from "react"
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { useGetUserEmailStats } from "@/features/email/use-get-stats"
import { useUnsubscribeDomain } from "@/features/email/use-post-unsubscribe"

type EmailStatsRow = {
  domain: string | null
  total: number
  read_count: number
  unread_count: number
  unread_percentage: number
}

const clampPercentage = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}

const formatPercentage = (value: number): string => {
  return `${Math.round(clampPercentage(value))}%`
}

const getReadPercentage = (row: EmailStatsRow): number => {
  if (!row.total || row.total <= 0) return 0
  return clampPercentage((row.read_count / row.total) * 100)
}

const getDomainLabel = (domain: string | null): string => {
  return domain?.trim() || "Unknown sender"
}

const normalizeRows = (value: unknown): EmailStatsRow[] => {
  if (Array.isArray(value)) {
    return value as EmailStatsRow[]
  }

  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return (value as { data: EmailStatsRow[] }).data
  }

  return []
}

const getUnreadPercentage = (row: EmailStatsRow): number => {
  return clampPercentage(row.unread_percentage)
}

const ProgressBar = ({
  percentage,
  className,
}: {
  percentage: number
  className?: string
}) => {
  const safePercentage = clampPercentage(percentage)

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
  )
}

const EmailStats = () => {
  const { data, isLoading, isError } = useGetUserEmailStats()
  const unsubscribeMutation = useUnsubscribeDomain();
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "total", desc: true },
  ])
  const [columnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([])

  const rows = React.useMemo(() => normalizeRows(data), [data])

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
          <div className="max-w-50 truncate font-medium sm:max-w-md" title={getDomainLabel(row.original.domain)}>
            {getDomainLabel(row.original.domain)}
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
          <span className="tabular-nums text-muted-foreground">{row.original.total}</span>
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
          const domain = row.original.domain;
          if (!domain) return null;
          return (
            <Button
              variant="outline"
              size="sm"
              disabled={unsubscribeMutation.isPending}
              onClick={() => unsubscribeMutation.mutate({ domain })}
            >
              Unsubscribe
            </Button>
          )
        }
      },
    ],
    [unsubscribeMutation]
  )

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
  })

  if (isLoading) {
    return (
      <div className="">
        <div className="space-y-3 p-4">
          {[...Array(6)].map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unable to load email stats</AlertTitle>
        <AlertDescription>
          Please refresh the page and try again.
        </AlertDescription>
      </Alert>
    )
  }

  if (rows.length === 0 && !isLoading) {
    return (
      <div className="text-muted-foreground rounded-lg border p-6 text-sm">
        No email statistics available yet.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <Input
          placeholder="Filter domains..."
          value={(table.getColumn("domain")?.getFilterValue() as string) ?? ""}
          onChange={(event) =>
            table.getColumn("domain")?.setFilterValue(event.target.value)
          }
          className="max-w-sm"
        />
      </div>
      <div className="">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
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
                <TableRow 
                  key={row.id}
                  className="group transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="align-middle">
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
    </div>
  )
}

export default EmailStats