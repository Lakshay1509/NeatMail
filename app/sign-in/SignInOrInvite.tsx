"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SignIn } from "@clerk/nextjs";

// Clerk's signUpForceRedirectUrl overrides redirect_url/search params, dropping
// ref/invite on signup. Read from `?key=VALUE` or the nested redirect_url and
// re-attach them so proxy.ts can set the cookie after auth.
function useParamFromUrl(key: string): string | null {
  const searchParams = useSearchParams();

  const direct = searchParams.get(key);
  if (direct) return direct;

  const redirectUrl = searchParams.get("redirect_url");
  if (!redirectUrl) return null;

  try {
    return new URL(redirectUrl, window.location.origin).searchParams.get(key);
  } catch {
    return null;
  }
}

function SignInForm() {
  const ref = useParamFromUrl("ref");
  const invite = useParamFromUrl("invite");

  const params = new URLSearchParams();
  if (ref) params.set("ref", ref);
  if (invite) params.set("invite", invite);
  const qs = params.toString();

  const onboardingUrl = qs ? `/onboarding?${qs}` : "/onboarding";
  // An invite must route existing users (sign-in) to onboarding too, so the
  // join step runs; without an invite, returning users go straight to the app.
  const fallbackUrl = invite ? onboardingUrl : "/dashboard";

  return (
    <SignIn
      fallbackRedirectUrl={fallbackUrl}
      signUpForceRedirectUrl={onboardingUrl}
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
