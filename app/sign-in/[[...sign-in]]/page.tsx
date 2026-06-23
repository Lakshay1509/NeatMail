import { ShieldCheck, BadgeCheck, Sparkles } from 'lucide-react'
import Image from 'next/image'
import { SignInOrInvite } from '../SignInOrInvite'

export default function SignInPage() {
  return (
    <div className="flex overflow-hidden max-w-full h-[90vh]">
      {/* Left side - Sign in form */}
      <div className="flex-1 flex items-center justify-center mx-auto bg-background">
        <div className="w-full max-w-md space-y-12 px-6 md:px-0">

          <div className="space-y-2 mb-10 md:mb-20">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
              Your inbox,<br />finally under control
            </h1>
            <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
              Automatically organize newsletters, follow-ups, and client emails so your inbox stays clean without manual work.
            </p>
          </div>
          
          <SignInOrInvite />

          <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="size-3.5" />
              Privacy-first
            </span>
            <span className="size-1 rounded-full bg-muted-foreground/50" />
            <span className="flex items-center gap-1.5">
              <BadgeCheck className="size-3.5" />
              CASA Tier 2 verified
            </span>
           
            
          </div>

          <p className="text-xs text-center text-muted-foreground px-4">
            By signing up, you agree with our{" "}
          
            <a href="https://www.neatmail.app/privacy" className="underline underline-offset-4 hover:text-primary">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a href="https://www.neatmail.app/terms-and-conditions" className="underline underline-offset-4 hover:text-primary">
              Terms & Conditions
            </a>.
          </p>
        </div>
      </div>

      {/* Right side - Mascot */}
      <div className="hidden md:flex flex-1 bg-muted/30 items-center justify-center p-8 md:rounded-l-xl">
        <div className="text-center p-4 flex flex-col items-center gap-6">
          <Image src='/sign-in-mascot.png' width={400} height={400} alt='mascot' className="object-contain" />
          
        </div>
      </div>
    </div>
  )
}
