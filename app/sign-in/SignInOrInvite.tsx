"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SignIn } from "@clerk/nextjs";

// `signUpForceRedirectUrl` always wins over `redirect_url`/search params per
// Clerk's docs, so a referral code would otherwise get silently dropped on a
// brand-new signup. Pull it from a direct `?ref=CODE` here, or from inside
// `redirect_url` (the shape produced when an unauthenticated hit on a
// protected route like `/?ref=CODE` gets bounced here by auth.protect()),
// then re-attach it to the forced destination so proxy.ts gets another
// chance to set the nm_ref cookie after signup.
function useReferralCodeFromUrl(): string | null {
  const searchParams = useSearchParams();

  const direct = searchParams.get("ref");
  if (direct) return direct;

  const redirectUrl = searchParams.get("redirect_url");
  if (!redirectUrl) return null;

  try {
    return new URL(redirectUrl, window.location.origin).searchParams.get("ref");
  } catch {
    return null;
  }
}

function SignInForm() {
  const ref = useReferralCodeFromUrl();

  return (
    <SignIn
      fallbackRedirectUrl="/dashboard"
      signUpForceRedirectUrl={ref ? `/onboarding?ref=${encodeURIComponent(ref)}` : "/onboarding"}
      withSignUp={true}
    />
  );
}

export function SignInOrInvite() {
  return (
    <div className="flex justify-center w-full animate-in fade-in duration-500">
      <Suspense
        fallback={
          <SignIn fallbackRedirectUrl="/dashboard" signUpForceRedirectUrl="/onboarding" withSignUp={true} />
        }
      >
        <SignInForm />
      </Suspense>
    </div>
  );
}
