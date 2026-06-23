"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import posthog from "posthog-js";

export function PostHogIdentify() {
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (process.env.NODE_ENV === "development") return;
    if (!isLoaded || !user) return;
    posthog.identify(user.id, {
      email: user.primaryEmailAddress?.emailAddress,
      name: user.fullName,
      username: user.username,
    });
  }, [user, isLoaded]);

  return null;
}
