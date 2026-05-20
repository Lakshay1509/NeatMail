import { cn } from "@/lib/utils"
import Link from "next/link"
import { Button } from "@/components/ui/button"

interface NotSubscribedStateProps {
  title?: string
  description?: string
  width?: number | string
  height?: number | string
  className?: string
  imageClassName?: string
  action?: React.ReactNode
}

export function NotSubscribedState({
  title = "Premium feature",
  description,
  width = 240,
  height = 240,
  className,
  imageClassName,
  action,
}: NotSubscribedStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 py-12 text-center",
        className
      )}
    >
      <img
        src="/premium.svg"
        alt="Premium"
        width={width}
        height={height}
        className={cn("shrink-0 opacity-80", imageClassName)}
      />

      {title && (
        <h3 className="text-lg font-medium tracking-tight text-foreground">
          {title}
        </h3>
      )}

      {description && (
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}

      <div className="mt-2">
        {action ?? (
          <Button asChild>
            <Link href="/billing">Go to Billing</Link>
          </Button>
        )}
      </div>
    </div>
  )
}
