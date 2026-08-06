"use client"
import { useState } from "react"
import {
  Home,
  Receipt,
  Tag,
  PenLine,
  Plug,
  MailX,
  Inbox,
  MessageSquareDashed,
  AlertCircle,
  Send,
  Bell,
  ChevronsUpDown,
  MessageSquareDashedIcon,
  Gift,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  UserCog,
  LogOut,
} from "lucide-react"
import { motion, LayoutGroup } from "framer-motion"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useClerk, useUser } from "@clerk/nextjs"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import ReferralCard from "@/components/ReferralCard"
import { useTierAccess } from "@/features/user/use-tier-access"
import { useGetTeam } from "@/features/organization/use-get-team"
import type { Tier } from "@/lib/tiers"
import posthog, { DisplaySurveyType } from "posthog-js"

const TIER_LABELS: Record<Tier, string> = {
  FREE: "Free",
  PRO: "Pro",
  MAX: "Max",
}

const TIER_COLORS: Record<Tier, string> = {
  FREE: "#6B7280",
  PRO: "#2563EB",
  MAX: "#D97706",
}

// Feedback is collected through a PostHog survey instead of a third-party form.
// Create a *popover* survey in the PostHog dashboard and set its ID in
// NEXT_PUBLIC_POSTHOG_FEEDBACK_SURVEY_ID. displaySurvey renders PostHog's own
// styled popover and captures the "survey sent" response automatically;
// ignoreConditions/ignoreDelay force it open on click, bypassing the survey's
// targeting rules and configured delay.
const FEEDBACK_SURVEY_ID = process.env.NEXT_PUBLIC_POSTHOG_FEEDBACK_SURVEY_ID

function openFeedbackSurvey() {
  if (!FEEDBACK_SURVEY_ID) {
    console.warn(
      "[feedback] NEXT_PUBLIC_POSTHOG_FEEDBACK_SURVEY_ID is not set — cannot open feedback survey",
    )
    return
  }
  posthog.displaySurvey(FEEDBACK_SURVEY_ID, {
    displayType: DisplaySurveyType.Popover,
    ignoreConditions: true,
    ignoreDelay: true,
  })
}

type SidebarItem = {
  title: string
  url?: string
  icon: LucideIcon
  external?: boolean
  danger?: boolean
  onClick?: () => void
}

const items: SidebarItem[] = [
  { title: "Home", url: "/", icon: Home },
  { title: "Chat", url: "/chat", icon: MessageSquareDashedIcon },
  // { title: "Todos", url: "/todos", icon: CheckSquare },
  { title: "Labels", url: "/settings/labels", icon: Tag },
  { title: "Draft preference", url: "/settings/draft-preference", icon: PenLine },
  { title: "Follow-up", url: "/settings/follow-up", icon: Send },
  { title: "Integrations", url: "/integrations", icon: Plug },
]

// Everything that used to live behind the footer's "User settings" disclosure.
// It now hangs off the profile row's dropdown, which is the one footer control
// that still works at 3rem wide — a collapsible group cannot render its
// children inside the icon rail.
const userSettingsItems: SidebarItem[] = [
  { title: "Billing", url: "/billing", icon: Receipt },
  { title: "Team", url: "/organization", icon: Users },
  { title: "Daily Digest", url: "/settings/digest", icon: Bell },
  { title: "Feedback", icon: MessageSquareDashed, onClick: openFeedbackSurvey },
]

// const followUpItems: SidebarItem[] = [
//   { title: "Follow ups", url: "/follow-ups", icon: Send },
// ]

const cleanupItems: SidebarItem[] = [
  { title: "Unsubscribe", url: "/unsubscribe", icon: MailX },
  { title: "Large emails", url: "/storage", icon: Inbox },
]

const FREE_GATED_TITLES = new Set([
  "AI Chat",
  "Labels",
  "Draft preference",
  "Daily Digest",
  "Integrations",
  "Follow-up",
  "Unsubscribe",
  "Large emails",
  "Todos"
])

// Desktop-only. On mobile the sidebar is a sheet, so its toggle belongs in the
// page header where it stays reachable once the sheet is shut.
function SidebarCollapseButton() {
  const { toggleSidebar, state } = useSidebar()
  const collapsed = state === "collapsed"
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar"

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={label}
      title={label}
      className="hidden size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/55 outline-hidden ring-sidebar-ring transition-colors duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 md:inline-flex"
    >
      {collapsed ? (
        <PanelLeftOpen size={16} aria-hidden="true" />
      ) : (
        <PanelLeftClose size={16} aria-hidden="true" />
      )}
    </button>
  )
}

function initialsOf(name: string) {
  const letters = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
  return letters.toUpperCase() || "U"
}

// A plain <img>: next/image has no remotePatterns configured, and img.clerk.com
// is already allow-listed by the img-src CSP directive in next.config.ts.
function UserAvatar({ src, name }: { src?: string; name: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initialsOf(name)
      )}
    </span>
  )
}

export function AppSidebar() {
  const { isMobile, setOpenMobile } = useSidebar()
  const pathname = usePathname()
  const { tier, isFree } = useTierAccess()
  const { data: team } = useGetTeam()
  const { user } = useUser()
  const { signOut, openUserProfile } = useClerk()
  const [referralOpen, setReferralOpen] = useState(false)

  // Non-admin team members ride the admin's plan and can't earn referral
  // rewards (see the /api/referral/code guard), so hide "Refer and Earn" for
  // them. Default to showing it until the role loads — solo users and admins
  // are the common case, and the backend enforces the block regardless.
  const isTeamMember = team?.role === "member"

  const displayName = user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || "Account"
  const email = user?.primaryEmailAddress?.emailAddress ?? ""
  const planLabel = isFree ? "Not subscribed" : `${TIER_LABELS[tier]} plan`
  const planColor = isFree ? TIER_COLORS.FREE : TIER_COLORS[tier]

  const handleLinkClick = () => {
    if (isMobile) setOpenMobile(false)
  }

  const renderItems = (items: SidebarItem[]) =>
    items.map((item) => {
      const isActive = item.url
        ? pathname === item.url || (item.url !== "/" && pathname.startsWith(item.url))
        : false
      const isDisabled = isFree && FREE_GATED_TITLES.has(item.title)
      const Icon = item.icon

      const content = (
        <>
          {isActive && (
            <motion.div
              layoutId="activeIndicator"
              className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-indigo-500"
              transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            />
          )}
          <Icon size={16} className="shrink-0 opacity-70 group-data-[active=true]/menu-button:opacity-100 group-hover:opacity-100" aria-hidden="true" />
          <span>{item.title}</span>
          {item.title === "Chat" && (
            <span className="text-[9px] font-semibold tracking-wider uppercase text-[#a39e98] ml-auto px-1.5 py-0.5 rounded-full border border-[#e6e6e6] leading-none">
              beta
            </span>
          )}
        </>
      )

      const buttonClassName = cn(
        "group/menu-button relative",
        item.danger && "text-red-600 hover:text-red-700",
        isDisabled && "opacity-40 pointer-events-none",
      )

      return (
        <SidebarMenuItem key={item.title}>
          {item.onClick ? (
            <SidebarMenuButton
              isActive={isActive}
              tooltip={item.title}
              className={buttonClassName}
              onClick={() => {
                item.onClick?.()
                handleLinkClick()
              }}
            >
              {content}
            </SidebarMenuButton>
          ) : (
            <SidebarMenuButton asChild isActive={isActive} tooltip={item.title} className={buttonClassName}>
              <Link href={item.url!} onClick={handleLinkClick} {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                {content}
              </Link>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      )
    })

  // Shared by the dropdown's link and action rows so both keep the same
  // tier-gating and mobile-sheet-dismiss behaviour as the main nav.
  const renderSettingsItem = (item: SidebarItem) => {
    const Icon = item.icon
    const isDisabled = isFree && FREE_GATED_TITLES.has(item.title)

    if (item.onClick) {
      return (
        <DropdownMenuItem
          key={item.title}
          disabled={isDisabled}
          onSelect={() => {
            item.onClick?.()
            handleLinkClick()
          }}
        >
          <Icon aria-hidden="true" />
          {item.title}
        </DropdownMenuItem>
      )
    }

    return (
      <DropdownMenuItem key={item.title} asChild disabled={isDisabled}>
        <Link href={item.url!} onClick={handleLinkClick}>
          <Icon aria-hidden="true" />
          {item.title}
        </Link>
      </DropdownMenuItem>
    )
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-2">
        <div className="flex h-10 items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <Link
            href="/"
            onClick={handleLinkClick}
            aria-label="NeatMail home"
            className="flex min-w-0 items-center rounded-md px-1 outline-hidden ring-sidebar-ring focus-visible:ring-2 group-data-[collapsible=icon]:hidden"
          >
            <Image src="/logo.png" width={110} height={38} alt="NeatMail" priority className="h-8 w-auto" />
          </Link>
          {/* Optical, not geometric: logo.png is 132px tall and the "N" mark
              fills all of it (6–127), but the wordmark only spans 23–78 —
              centered 15.5px / 11.7% higher than the asset's box. items-center
              lines the button up with the mark; the eye reads it against the
              wordmark. 11.7% of the rendered h-8 is 3.75px, so nudge up 4px.
              Re-measure if the logo asset is ever replaced. Icon mode drops it:
              the logo is hidden there and the button centers on its own. */}
          <div className="-mt-1 ml-auto group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:ml-0">
            <SidebarCollapseButton />
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="overflow-x-hidden">
        <SidebarGroup>
          <SidebarGroupLabel />
          <SidebarGroupContent>
            <SidebarMenu>
              <LayoutGroup>
                {renderItems(items)}
              </LayoutGroup>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10.5px] font-medium tracking-widest uppercase text-sidebar-foreground/50 pb-1">
            Review
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <LayoutGroup>
                {renderItems(followUpItems)}
              </LayoutGroup>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup> */}
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10.5px] font-medium tracking-widest uppercase text-sidebar-foreground/50 pb-1">
            Cleanup
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <LayoutGroup>
                {renderItems(cleanupItems)}
              </LayoutGroup>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  tooltip={displayName}
                  className="cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <UserAvatar src={user?.imageUrl} name={displayName} />
                  <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm font-medium">{displayName}</span>
                    <span className="truncate text-xs font-medium" style={{ color: planColor }}>
                      {planLabel}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto opacity-50 group-data-[collapsible=icon]:hidden" aria-hidden="true" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={isMobile ? "top" : "right"}
                align="end"
                sideOffset={8}
                className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5">
                    <UserAvatar src={user?.imageUrl} name={displayName} />
                    <div className="grid min-w-0 flex-1 text-left leading-tight">
                      <span className="truncate text-sm font-medium">{displayName}</span>
                      {email && (
                        <span className="truncate text-xs text-muted-foreground">{email}</span>
                      )}
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    handleLinkClick()
                    openUserProfile()
                  }}
                >
                  <UserCog aria-hidden="true" />
                  Manage account
                </DropdownMenuItem>
                {userSettingsItems.map(renderSettingsItem)}
                {!isTeamMember && (
                  <DropdownMenuItem
                    onSelect={() => {
                      handleLinkClick()
                      setReferralOpen(true)
                    }}
                  >
                    <Gift aria-hidden="true" />
                    Refer and Earn
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild variant="destructive">
                  <Link href="/danger" onClick={handleLinkClick}>
                    <AlertCircle aria-hidden="true" />
                    Danger Zone
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => signOut({ redirectUrl: "/sign-in" })}>
                  <LogOut aria-hidden="true" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
      {!isTeamMember && (
        <Dialog open={referralOpen} onOpenChange={setReferralOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <Gift className="h-5 w-5 text-primary" />
                Refer and Earn
              </DialogTitle>
              <DialogDescription className="sr-only">
                Share your referral link and earn free months when friends subscribe.
              </DialogDescription>
            </DialogHeader>
            <ReferralCard bare />
          </DialogContent>
        </Dialog>
      )}
    </Sidebar>
  )
}
