"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

type PageHeaderProps = {
  /** Omit on the dashboard — the bar then collapses to the mobile menu button. */
  title?: string
  actions?: React.ReactNode
  className?: string
}

/**
 * The per-page title bar that replaced the global navbar.
 *
 * It also carries the sidebar toggle on small screens: the desktop toggle lives
 * in the sidebar header, but on mobile the sidebar is an off-canvas sheet, so
 * once it closes there would be nothing left to reopen it.
 */
export function PageHeader({ title, actions, className }: PageHeaderProps) {
  if (!title) {
    return (
      <div
        className={cn(
          "sticky top-0 z-30 flex h-14 shrink-0 items-center border-b border-border/60 bg-background/85 px-3 backdrop-blur-md md:hidden",
          className,
        )}
      >
        {/* size-11 = 44px, the minimum touch target. */}
        <SidebarTrigger className="-ml-1.5 size-11" />
      </div>
    )
  }

  return (
    <header
      className={cn(
        // shrink-0: the bar is a fixed-height flex child of the page column, and
        // a page taller than the viewport would otherwise flex-squeeze it.
        "sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background/85 px-3 backdrop-blur-md md:h-16 md:gap-3 md:px-10",
        className,
      )}
    >
      <SidebarTrigger className="-ml-1.5 size-11 shrink-0 md:hidden" />
      <h1 className="min-w-0 flex-1 truncate font-logo text-lg font-semibold tracking-tight md:text-2xl">
        {title}
      </h1>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
