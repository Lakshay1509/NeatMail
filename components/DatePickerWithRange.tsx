"use client"

import * as React from "react"
import { format, isBefore, isAfter, startOfDay, subMonths } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerWithRangeProps extends React.HTMLAttributes<HTMLDivElement> {
  date: DateRange | undefined
  setDate: React.Dispatch<React.SetStateAction<DateRange | undefined>>
  isStorage?: boolean
}

export function DatePickerWithRange({
  className,
  date,
  setDate,
  isStorage,
}: DatePickerWithRangeProps) {
  const today = startOfDay(new Date())
  const monthsAgo = isStorage ? 12 : 2
  const pastLimit = subMonths(today, monthsAgo)

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id="date"
            variant={"outline"}
            className={cn(
              "w-[300px] justify-start text-left font-normal",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, "LLL dd, y")} -{" "}
                  {format(date.to, "LLL dd, y")}
                </>
              ) : (
                format(date.from, "LLL dd, y")
              )
            ) : (
              <span>Pick a date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from || subMonths(today, monthsAgo)}
            selected={date}
            onSelect={setDate as any}
            numberOfMonths={2}
            disabled={(d) => {
              const checkDate = startOfDay(d)
              return isBefore(checkDate, pastLimit) || isAfter(checkDate, today)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
