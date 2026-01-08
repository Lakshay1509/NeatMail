'use client'

import { UserButton, useUser } from '@clerk/nextjs'
import Link from 'next/link'
import { SidebarTrigger } from './ui/sidebar';
import { usePathname } from 'next/navigation';


const Navbar = () => {
  const { isSignedIn } = useUser();
  const pathname = usePathname()

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-8 bg-white/80 backdrop-blur-md border-b border-gray-200 shadow-sm">
       {pathname === '/dashboard' && <SidebarTrigger className='md:hidden' />}
        <div className="text-xl font-bold text-gray-800">
           MailOrbit
        </div>
        
        <div className="flex items-center gap-4">
            {isSignedIn ? (
                <UserButton afterSignOutUrl="/"/>
            ) : (
                <Link 
                    href="/sign-in"
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    Login
                </Link>
            )}
        </div>
    </div>
  )
}

export default Navbar

