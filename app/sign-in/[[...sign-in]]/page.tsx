import { SignIn } from '@clerk/nextjs'
import Link from 'next/link'

export default function SignInPage() {
  return (
    <div className="flex overflow-hidden max-w-full h-screen">
      {/* Left side - Sign in form */}
      <div className="flex-1 flex items-center justify-center mx-auto bg-background">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Get Started</h1>
            <p className="text-muted-foreground">Sign in to access your account</p>
          </div>

          <div className="flex justify-center">
            
            <SignIn forceRedirectUrl="/" withSignUp={true}/>
          </div>

          <p className="text-xs text-center text-muted-foreground px-4">
            By signing up, you agree with our{" "}
          
            <a href="https://www.neatmail.tech/privacy" className="underline underline-offset-4 hover:text-primary">
              Privacy Policy
            </a>.
          </p>
        </div>
      </div>

      {/* Right side - App branding */}
      <div className="hidden md:flex flex-1 bg-gray-50 items-center justify-center p-8 md:rounded-l-xl">
        <div className="text-center p-4">
          <p className="text-6xl  font-semibold font-logo text-foreground select-none">
            NeatMail
          </p>
        </div>
      </div>
    </div>
  )
}



