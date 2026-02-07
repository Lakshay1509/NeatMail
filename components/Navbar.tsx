'use client'

import { UserButton, useUser } from '@clerk/nextjs'
import Link from 'next/link'
import { SidebarTrigger } from './ui/sidebar';
import { usePathname } from 'next/navigation';
import { useGetUserSubscribed } from '@/features/user/use-get-subscribed';

const Navbar = () => {
  const { isSignedIn } = useUser();
  const pathname = usePathname();
  const {data,isLoading,isError} = useGetUserSubscribed();
  
  const isSubscribed = data?.subscribed===false;
  const showUnsubscribedMessage = isSignedIn && isSubscribed && !isLoading && !pathname.includes('/sign-in');
  const signInPage = pathname.includes('/sign-in');

  return (
    <>
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-8 bg-white/80 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="flex items-center">
         {isSignedIn && !signInPage && <SidebarTrigger size='icon-lg'/>}
       </div>
        <h1 className="text-2xl font-bold text-gray-800 font-logo select-none">
          NeatMail
        </h1>
        
        <div className="flex items-center gap-4">
          {isSignedIn ? (
            <UserButton afterSignOutUrl="/"/>
          ) : (
            !signInPage && <Link 
              href="/sign-in"
              className="px-4 py-2 text-sm font-medium text-white bg-black rounded-lg hover:bg-gray-700 transition-colors"
            >
              Login
            </Link>
          )}
        </div>
    </div>
    
      {showUnsubscribedMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 fade-in duration-500">
           <div className="bg-white p-4 rounded-xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 max-w-xs group">
              <div className="flex items-center gap-2 mb-1">
                 <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse"/>
                 <p className="text-sm font-semibold text-gray-800">
                    Not Subscribed
                 </p>
              </div>
            
              <Link 
                href="/billing" 
                className="text-xs font-medium text-blue-600 group-hover:underline flex items-center gap-1 ml-4"
              >
                Go to Billing
                <span className="group-hover:translate-x-0.5 transition-transform">→</span>
              </Link>
           </div>
        </div>
      )}
    </>
  )
}

export default Navbar

