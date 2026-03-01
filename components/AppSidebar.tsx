import { Mail, Home, MessageSquareDashed, Receipt, AlertCircle, Tag, ShieldCheck } from "lucide-react"


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
  {
    title: "Privacy",
    url: "/settings/privacy",
    icon: ShieldCheck,
  }
 
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
                      <item.icon className="h-5! w-5!" />
                      <span className="text-base ">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

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