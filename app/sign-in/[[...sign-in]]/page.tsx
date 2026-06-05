import Image from 'next/image'
import { SignInOrInvite } from '../SignInOrInvite'

export default function SignInPage() {
  return (
    <div className="flex overflow-hidden max-w-full h-screen">
      {/* Left side - Sign in form */}
      <div className="flex-1 flex items-center justify-center mx-auto bg-background">
        <div className="w-full max-w-md space-y-8 px-6 md:px-0">
          
          <SignInOrInvite />

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
