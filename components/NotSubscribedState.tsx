import { cn } from "@/lib/utils"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import type { Tier } from "@/lib/tiers"

interface NotSubscribedStateProps {
  title?: string
  description?: string
  tier?: Tier
  width?: number | string
  height?: number | string
  className?: string
  imageClassName?: string
  action?: React.ReactNode
}

const TIER_CTA: Record<Tier, string> = {
  FREE: "Upgrade to Pro",
  PRO: "Upgrade to Max",
  MAX: "You're on the best plan",
}

export function NotSubscribedState({
  title = "Premium feature",
  description,
  tier = "PRO",
  width = 240,
  height = 240,
  className,
  imageClassName,
  action,
}: NotSubscribedStateProps) {
  const ctaText = TIER_CTA[tier]

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
        width={width as number}
        height={height as number}
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
            <Link href="/billing">{ctaText}</Link>
          </Button>
        )}
      </div>
    </div>
  )
}
