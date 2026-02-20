import { Mail, Home, MessageSquareDashed, Settings, Receipt, AlertCircle, ChevronRight, Tag, ShieldCheck } from "lucide-react"
import { Collapsible } from "radix-ui"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar"
import Link from "next/link"

// Menu items.
const items = [
  {
    title: "Home",
    url: "/",
    icon: Home,
  },
  {
    title: "Mails",
    url: "/mails",
    icon: Mail,
  },
  {
    title: "Drafts",
    url: "/drafts",
    icon: MessageSquareDashed,
  },
  {
    title : 'Billing',
    url : "/billing",
    icon : Receipt
  },
]

const settingsSubItems = [
  {
    title: "Labels",
    url: "/settings/labels",
    icon: Tag,
  },
  {
    title: "Privacy",
    url: "/settings/privacy",
    icon: ShieldCheck,
  },
]

export function AppSidebar() {
  const { isMobile, setOpenMobile } = useSidebar()

  const handleLinkClick = () => {
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <Sidebar >
      <SidebarContent className="lg:mt-16">
        <SidebarGroup>
          <SidebarGroupLabel></SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild className="h-12">
                    <Link href={item.url} onClick={handleLinkClick}>
                      <item.icon className="h-5! w-5!"  />
                      <span className="text-base ">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {/* Collapsible Settings */}
              <Collapsible.Root asChild className="group/collapsible">
                <SidebarMenuItem>
                  <Collapsible.Trigger asChild>
                    <SidebarMenuButton className="h-12">
                      <Settings className="h-5! w-5!" />
                      <span className="text-base">Settings</span>
                      <ChevronRight className="ml-auto h-4! w-4! transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </Collapsible.Trigger>
                  <Collapsible.Content>
                    <SidebarMenuSub>
                      {settingsSubItems.map((sub) => (
                        <SidebarMenuSubItem key={sub.title}>
                          <SidebarMenuSubButton asChild>
                            <Link href={sub.url} onClick={handleLinkClick}>
                              <sub.icon className="h-4! w-4!" />
                              <span>{sub.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </Collapsible.Content>
                </SidebarMenuItem>
              </Collapsible.Root>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="h-12 text-red-600 hover:text-red-700">
              <Link href="/danger" onClick={handleLinkClick}>
                <AlertCircle className="!h-4 !w-4" />
                <span className="text-sm">Delete Account</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}