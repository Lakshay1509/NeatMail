"use client";

import { SignIn } from "@clerk/nextjs";

export function SignInOrInvite() {
  return (
    <div className="flex justify-center w-full animate-in fade-in duration-500">
      <SignIn
        fallbackRedirectUrl="/dashboard"
        signUpForceRedirectUrl="/onboarding"
        withSignUp={true}
      />
    </div>
  );
}

