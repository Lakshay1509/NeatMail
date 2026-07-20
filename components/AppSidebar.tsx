"use client"
import { useState } from "react"
import { Home, Receipt, Tag, PenLine, Plug, MailX, Inbox, MessageSquareDashed, AlertCircle, Send, Bell, CheckSquare, ChevronDown, MessageSquareDashedIcon, Gift, Users } from "lucide-react"
import { motion, LayoutGroup } from "framer-motion"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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

const userSettingsItems: SidebarItem[] = [
  { title: "Billing", url: "/billing", icon: Receipt },
  { title: "Team", url: "/organization", icon: Users },
  { title: "Daily Digest", url: "/settings/digest", icon: Bell },
  { title: "Feedback", icon: MessageSquareDashed, onClick: openFeedbackSurvey },
  { title: "Danger Zone", url: "/danger", icon: AlertCircle, danger: true },
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

export function AppSidebar() {
  const { isMobile, setOpenMobile } = useSidebar()
  const pathname = usePathname()
  const { tier, isFree } = useTierAccess()
  const { data: team } = useGetTeam()
  const [referralOpen, setReferralOpen] = useState(false)

  // Non-admin team members ride the admin's plan and can't earn referral
  // rewards (see the /api/referral/code guard), so hide "Refer and Earn" for
  // them. Default to showing it until the role loads — solo users and admins
  // are the common case, and the backend enforces the block regardless.
  const isTeamMember = team?.role === "member"

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
              className={buttonClassName}
              onClick={() => {
                item.onClick?.()
                handleLinkClick()
              }}
            >
              {content}
            </SidebarMenuButton>
          ) : (
            <SidebarMenuButton asChild isActive={isActive} className={buttonClassName}>
              <Link href={item.url!} onClick={handleLinkClick} {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                {content}
              </Link>
            </SidebarMenuButton>
          )}
        </SidebarMenuItem>
      )
    })

  return (
    <Sidebar>
      <SidebarContent className="lg:mt-12 overflow-x-hidden">
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
            <SidebarMenuButton className="pointer-events-none">
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: isFree ? "#6B7280" : TIER_COLORS[tier] }}
              />
              <span
                className="text-xs font-medium"
                style={{ color: isFree ? "#6B7280" : TIER_COLORS[tier] }}
              >
                {isFree ? "Not subscribed" : `${TIER_LABELS[tier]} plan`}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {!isTeamMember && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setReferralOpen(true)}
                className="text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
              >
                <Gift size={14} className="shrink-0" aria-hidden="true" />
                <span>Refer and Earn</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <Collapsible className="group/collapsible w-full">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton className="text-[10.5px] font-medium tracking-widest uppercase text-sidebar-foreground/50">
                  <span>User settings</span>
                  <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenu>
                  <LayoutGroup>
                    {renderItems(userSettingsItems)}
                  </LayoutGroup>
                </SidebarMenu>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        </SidebarMenu>
      </SidebarFooter>
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