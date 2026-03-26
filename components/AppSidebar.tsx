"use client"
import { Mail, Home, MessageSquareDashed, Receipt, AlertCircle, Tag,Shredder } from "lucide-react"


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
  useSidebar,
} from "@/components/ui/sidebar"
import Link from "next/link"
import { usePathname } from "next/navigation"

// Menu items.
const items = [
  {
    title: "Home",
    url: "/",
    icon: Home,
  },
  {
    title: "Unsubscribe",
    url: "/unsubscribe",
    icon: Shredder,
  },
  {
    title: 'Billing',
    url: "/billing",
    icon: Receipt
  },
  {
    title: "Labels",
    url: "/settings/labels",
    icon: Tag,
  },
   {
    title: 'Draft Preference',
    url: "/settings/draft-preference",
    icon: MessageSquareDashed
  },
  // {
  //   title: "Privacy",
  //   url: "/settings/privacy",
  //   icon: ShieldCheck,
  // }
 
]


export function AppSidebar() {
  const { isMobile, setOpenMobile } = useSidebar()
  const pathname = usePathname()

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
              {items.map((item) => {
                const isActive = pathname === item.url || (item.url !== "/" && pathname.startsWith(item.url))
                return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild className={`h-12 ${isActive ? "bg-neutral-100 dark:bg-neutral-800 font-semibold" : ""}`}>
                    <Link href={item.url} onClick={handleLinkClick}>
                      <item.icon className="h-5! w-5!" />
                      <span className="text-base ">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )})}

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