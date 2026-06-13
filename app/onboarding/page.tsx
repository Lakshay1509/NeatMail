"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

const MAX_RETRIES = 3;

export default function OnboardingPage() {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"loading" | "retrying" | "redirecting">("loading");

  const complete = useCallback(async () => {
    const res = await fetch("/api/onboarding/complete");
    if (!res.ok) throw new Error("API returned " + res.status);
    setState("redirecting");
    router.push("/");
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    complete().catch(() => {
      if (cancelled) return;
      if (attempt < MAX_RETRIES - 1) {
        setState("retrying");
        const id = setTimeout(() => setAttempt((n) => n + 1), 1000);
        return () => { cancelled = true; clearTimeout(id); };
      }
      setState("redirecting");
      router.push("/");
    });

    return () => { cancelled = true; };
  }, [attempt, complete, router]);

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-100px)]">
      <div className="flex flex-col items-center gap-6 text-center max-w-sm">
        <h1 className="text-xl font-logo text-foreground">
          Setting up your inbox
        </h1>

        <p className="text-sm text-muted-foreground leading-relaxed max-w-[28ch]">
          {state === "retrying"
            ? "Taking a bit longer than expected. Still working..."
            : "This should only take a moment."}
        </p>

        <div className="relative w-48 h-[2px] overflow-hidden rounded-full bg-border">
          <span
            className="progress-bar"
            style={{
              animationDuration: state === "retrying" ? "1.2s" : "0.8s",
            }}
          />
        </div>
      </div>

      <style>{`
        .progress-bar {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: var(--foreground);
        }
        @media (prefers-reduced-motion: no-preference) {
          .progress-bar {
            animation: progress 0.8s ease-in-out infinite;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .progress-bar {
            opacity: 0.4;
            width: 40%;
            left: 30%;
          }
        }
        @keyframes progress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
