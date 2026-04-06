"use client";

import { useEffect, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { deleteUnauthorizedUser } from "@/app/actions/authActions";

export function AccessDeniedAlert() {
  const { signOut } = useClerk();
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    toast.error("Unauthorized access. You are not on the invite list.");

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (countdown === 0) {
      handleDenial();
    }
  }, [countdown]);

  const handleDenial = async () => {
    toast.error("Removing unauthorized account...");
    try {
      await deleteUnauthorizedUser(); 
      await signOut(); 
    } catch (e) {
      console.error(e);
    }
    router.push("/sign-in");
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md flex items-center justify-center">
      <div className="bg-card p-8 rounded-xl shadow-2xl border text-center max-w-md w-full">
        <h2 className="text-2xl font-bold text-destructive mb-4">Access Denied</h2>
        <p className="text-foreground mb-6">
          You bypassed the invite screen, but your email is not authorized to use this application yet.
        </p>
        <div className="bg-muted p-4 rounded-lg">
          <p className="text-muted-foreground text-sm font-medium animate-pulse">
            Removing your account and redirecting in {countdown}s...
          </p>
        </div>
      </div>
    </div>
  );
}
