'use client'

import { UserButton, useUser } from '@clerk/nextjs'
import Link from 'next/link'
import { SidebarTrigger } from './ui/sidebar';




const Navbar = () => {
  const { isSignedIn } = useUser();
  

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-8 bg-white/80 backdrop-blur-md border-b border-gray-200 shadow-sm">
       <SidebarTrigger className="md:hidden" size='icon-lg'/>
        <h1 className="text-2xl font-bold text-gray-800 font-logo select-none">
           NeatMail
        </h1>
        
        <div className="flex items-center gap-4">
            {isSignedIn ? (
                <UserButton afterSignOutUrl="/"/>
            ) : (
                <Link 
                    href="/sign-in"
                    className="px-4 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-blue-700 transition-colors"
                >
                    Login
                </Link>
            )}
        </div>
    </div>
  )
}

export default Navbar

