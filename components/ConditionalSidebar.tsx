'use client'

import { usePathname } from 'next/navigation'
import { AppSidebar } from '@/components/AppSidebar'
import { SidebarTrigger } from './ui/sidebar'

export function ConditionalSidebar() {
  const pathname = usePathname()

  // Hide sidebar on auth pages
  if (pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')) {
    return null
  }

  return (
    <>
      <AppSidebar />
      <SidebarTrigger className="hidden md:block md:ml-2" />
    </>
  )
}
