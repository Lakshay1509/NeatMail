import { SignIn } from '@clerk/nextjs'
import Image from 'next/image'
import Link from 'next/link'
import { checkInviteToken } from '../actions'
import { SignInOrInvite } from '../SignInOrInvite'

export default async function SignInPage(props: {
  params: Promise<{ [key: string]: string | string[] | undefined }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const signInPath = params['sign-in'] as string[] | undefined;
  
  const accessToken = searchParams.accessToken as string | undefined;
  
  let validToken = false;
  let tokenMessage = "";

  // If user is inside a specific Clerk authentication step (like /sso-callback)
  // we must instantly render the <SignIn /> component to let Clerk process it.
  if (signInPath && signInPath.length > 0) {
    validToken = true;
  } else if (accessToken) {
    const res = await checkInviteToken(accessToken);
    validToken = res.valid;
    if (!validToken) {
      tokenMessage = res.message || "Invalid or expired token";
    }
  }

  return (
    <div className="flex overflow-hidden max-w-full h-screen">
      {/* Left side - Sign in form */}
      <div className="flex-1 flex items-center justify-center mx-auto bg-background">
        <div className="w-full max-w-md space-y-8 px-6 md:px-0">
          
          <SignInOrInvite initialValidToken={validToken} initialMessage={tokenMessage} />

          <p className="text-xs text-center text-muted-foreground px-4">
            By signing up, you agree with our{" "}
          
            <a href="https://www.neatmail.app/privacy" className="underline underline-offset-4 hover:text-primary">
              Privacy Policy
            </a>.
          </p>
        </div>
      </div>

      {/* Right side - App branding */}
      <div className="hidden md:flex flex-1 bg-gray-50 items-center justify-center p-8 md:rounded-l-xl">
        <div className="text-center p-4 space-y-6 flex flex-col">
          <Image src='/logo.png' width={300} height={300} alt='logo' />
        </div>
      </div>
    </div>
  )
}



