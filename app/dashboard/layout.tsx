import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/AppSidebar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
      <div className="flex w-full">
        <AppSidebar />
        <main className=" flex-1 overflow-auto">
          <SidebarTrigger className="hidden md:block"/>
          {children}
        </main>
      </div>
  )
}
