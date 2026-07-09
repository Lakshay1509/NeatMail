"use client"
import { useState } from "react"
import { Home, Receipt, Tag, PenLine, Plug, MailX, Inbox, MessageSquareDashed, AlertCircle, Send, Bell, CheckSquare, ChevronDown, MessageSquareDashedIcon, Gift } from "lucide-react"
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
import type { Tier } from "@/lib/tiers"

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

type SidebarItem = {
  title: string
  url: string
  icon: LucideIcon
  external?: boolean
  danger?: boolean
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
  { title: "Daily Digest", url: "/settings/digest", icon: Bell },
  { title: "Feedback", url: "https://forms.baytix.net/forms/neatmail-feedback-form-8fc4565d", icon: MessageSquareDashed, external: true },
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
  const [referralOpen, setReferralOpen] = useState(false)

  const handleLinkClick = () => {
    if (isMobile) setOpenMobile(false)
  }

  const renderItems = (items: SidebarItem[]) =>
    items.map((item) => {
      const isActive = pathname === item.url || (item.url !== "/" && pathname.startsWith(item.url))
      const isDisabled = isFree && FREE_GATED_TITLES.has(item.title)
      const Icon = item.icon
      return (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton
            asChild
            isActive={isActive}
            className={cn(
              "group/menu-button relative",
              item.danger && "text-red-600 hover:text-red-700",
              isDisabled && "opacity-40 pointer-events-none",
            )}
          >
            <Link href={item.url} onClick={handleLinkClick} {...("external" in item && item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
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
            </Link>
          </SidebarMenuButton>
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
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setReferralOpen(true)}
              className="text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
            >
              <Gift size={14} className="shrink-0" aria-hidden="true" />
              <span>Refer and Earn</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
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
    </Sidebar>
  )
}