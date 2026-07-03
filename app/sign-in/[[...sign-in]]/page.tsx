'use client'

import { useState, useEffect } from 'react'
import { ShieldCheck, BadgeCheck, Sparkles } from 'lucide-react'
import Image from 'next/image'
import { SignInOrInvite } from '../SignInOrInvite'

const carouselImages = [
  { src: '/sign-in/dashboard.webp', label: 'Visualize your inbox at a glance' },
  { src: '/sign-in/followUp.webp', label: 'Never miss a follow-up again' },
  { src: '/sign-in/integration.webp', label: 'Seamless integration with your favourite tools' },
  { src: '/sign-in/unsubscribe.webp', label: 'Unsubscribe with one click' },
]

export default function SignInPage() {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent(prev => (prev + 1) % carouselImages.length)
    }, 4000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex overflow-hidden max-w-full h-[90vh]">
      {/* Left side - Sign in form */}
      <div className="flex-1 flex items-center justify-center mx-auto bg-background">
        <div className="w-full max-w-md space-y-12 px-6 md:px-0">

          <div className="space-y-2 mb-10 ">
            <h1 className="text-2xl  font-semibold tracking-tight text-foreground">
              Your inbox,<br />finally under control
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
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

      {/* Right side - Carousel */}
      <div className="hidden lg:flex flex-1 bg-muted/30 items-center justify-center p-8 md:rounded-l-xl">
        <div className="w-full max-w-2xl flex flex-col items-center gap-4">
          <div className="relative w-full aspect-[19/12]">
            {carouselImages.map((item, i) => (
              <Image
                key={item.src}
                src={item.src}
                fill
                alt={item.label}
                className={`object-contain rounded-2xl transition-opacity duration-700 shadow-lg ${i === current ? 'opacity-100' : 'opacity-0'}`}
                priority={i === 0}
              />
            ))}
          </div>
          <p className="text-sm text-muted-foreground text-center min-h-[1.25rem]">
            {carouselImages[current].label}
          </p>
          <div className="flex gap-2">
            {carouselImages.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`size-2 rounded-full transition-all ${i === current ? 'bg-primary w-5' : 'bg-muted-foreground/40'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
