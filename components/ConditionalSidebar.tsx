'use client'

import { usePathname } from 'next/navigation'
import { AppSidebar } from '@/components/AppSidebar'


export function ConditionalSidebar() {
  const pathname = usePathname()

  // Hide sidebar on auth pages
  if (pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')) {
    return null
  }

  return (
    <>
      <AppSidebar />
      
    </>
  )
}
