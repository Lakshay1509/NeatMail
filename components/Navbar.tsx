'use client'

import { UserButton, useUser, useClerk } from '@clerk/nextjs'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { SidebarTrigger } from './ui/sidebar';
import { usePathname } from 'next/navigation';
import { useGetUserSubscribed } from '@/features/user/use-get-subscribed';
import { useTierAccess } from '@/features/user/use-tier-access';
import Image from 'next/image';

const Navbar = () => {
  const { isSignedIn } = useUser();
  const { addListener, session } = useClerk();
  const prevSession = useRef(!!session);

  useEffect(() => {
    return addListener((resources) => {
      const hasSession = !!resources.session;
      if (prevSession.current && !hasSession) {
        localStorage.removeItem("welcome_dialog_seen");
      }
      prevSession.current = hasSession;
    });
  }, [addListener]);
  const pathname = usePathname();
  const {data,isLoading,isError} = useGetUserSubscribed();
  const { tier, isFree } = useTierAccess();
  
  const tierLoaded = isSignedIn && !isLoading && !isError;
  const authPage = pathname.includes('/sign-in') || pathname.includes('/onboarding');
  const showTierBadge = tierLoaded && !authPage;

  return (
    <>
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-6 bg-white/80 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="flex items-center">
         {isSignedIn && !authPage && <SidebarTrigger size='icon-lg'/>}
        </div>

        <Image src='/logo.png' width={150} height={150} alt='logo' className={`mt-1.5 ${authPage ? "block" :"hidden md:block"}`}/>
        {!authPage &&<Image src='/logo-short.png' width={40} height={40} alt='logo' className=' block md:hidden'/>}
        
        <div className="flex items-center gap-4">
          {isSignedIn ? (
            <UserButton afterSignOutUrl="/"/>
          ) : (
            !authPage && <Link 
              href="/sign-in"
              className="px-4 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-700 transition-colors"
            >
              Login
            </Link>
          )}
        </div>
    </div>
    
      
    </>
  )
}

export default Navbar

