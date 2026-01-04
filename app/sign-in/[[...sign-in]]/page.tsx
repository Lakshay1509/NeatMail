import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'

export default function SignInPage() {
  return (
    <div className="flex overflow-hidden max-w-full min-h-[85vh]">
      {/* Left side - Sign in form */}
      <div className="flex-1 flex items-center justify-center mx-auto bg-background">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Get Started</h1>
            <p className="text-muted-foreground">Sign in to access your account</p>
          </div>

          <div className="flex justify-center">
            
            <SignIn/>
          </div>

          <p className="text-xs text-center text-muted-foreground px-4">
            By signing up, you agree with our{" "}
            <Link href="/terms-and-conditions" className="underline underline-offset-4 hover:text-primary">
              Terms and Conditions
            </Link>{" "}
            and{" "}
            <Link href="/privacy-policy" className="underline underline-offset-4 hover:text-primary">
              Privacy Policy
            </Link>.
          </p>
        </div>
      </div>

      {/* Right side - App branding */}
      <div className="hidden md:flex flex-1 bg-[#F8F4FF] items-center justify-center p-8 md:rounded-l-xl">
        <div className="text-center p-4">
          {/* <Image
            src="/logo.avif"
            alt="Safe or Not"
            width={250}
            height={80}
            className="max-w-full h-auto"
            unoptimized
          /> */}
        </div>
      </div>
    </div>
  )
}



