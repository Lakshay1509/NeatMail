"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Infinity, Sparkles, Sliders, Tag, Loader2 } from "lucide-react";

interface SubscriptionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SubscriptionModal = ({
  open,
  onOpenChange,
}: SubscriptionModalProps) => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAction = () => {
    router.push("/dashboard/billing");
  };

  const handlebilling = async () => {
    setIsLoading(true);
    setError("");
 
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        
      });

      const data = await response.json();

      if (response.ok) {
        window.location.href = data.url;
      } else {
        
        setError(data.error || "Something went wrong");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  const features = [
    {
      icon: Infinity,
      title: "Unlimited email tracking",
      desc: "Label unlimited emails.",
    },
    {
      icon: Tag,
      title: "Gmail labeling integration",
      desc: "Label your emails directly to your Gmail interface.",
    },
    {
      icon: Sliders,
      title: "Custom smart labels",
      desc: "Stay focused by choosing labels that matter to you.",
    },
    {
      icon: Sparkles,
      title: "AI Draft responses",
      desc: "Draft responses automatically for any pending replies.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-md p-6 rounded-2xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex flex-col items-center gap-2 text-center">
         
          <DialogTitle className="text-2xl font-bold sm:text-3xl mt-4">
            Unlock Premium Features
          </DialogTitle>
          <DialogDescription className="text-center text-muted-foreground">
            Supercharge your productivity and take control of your inbox today.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4 rounded-xl bg-indigo-50/50 p-4 dark:bg-zinc-900 border dark:border-zinc-800">
          {features.map((feature, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-black/5 dark:bg-zinc-800 dark:ring-white/10">
                <feature.icon className="h-5 w-5 " />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-semibold leading-none">
                  {feature.title}
                </h4>
                <p className="text-xs text-muted-foreground leading-snug">
                  {feature.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 w-full space-y-4">

  {error && (
    <span className="block text-center text-xs font-medium text-destructive">
      {error}
    </span>
  )}

  {/* Primary CTA */}
  <Button
    onClick={handlebilling}
    disabled={isLoading}
    className="w-full"
  >
    {isLoading ? (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Processing...
      </>
    ) : (
      <>
        Join Now <ArrowRight className="ml-2 h-4 w-4" />
      </>
    )}
  </Button>

  {/* OR Divider */}
  <div className="relative flex items-center justify-center">
    <div className="absolute inset-0 flex items-center">
      <div className="w-full border-t border-muted" />
    </div>
    <span className="relative bg-background px-3 text-xs text-muted-foreground">
      OR
    </span>
  </div>

  {/* Secondary CTA */}
  <Button
    onClick={handlebilling}
    disabled={isLoading}
    variant="outline"
    className="w-full text-muted-foreground border-muted hover:bg-muted/40"
  >
    {isLoading ? (
      <>
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Processing...
      </>
    ) : (
      <>
        Join for 7 days (cancel anytime)
        <ArrowRight className="ml-2 h-4 w-4" />
      </>
    )}
  </Button>

</div>

        
      </DialogContent>
    </Dialog>
  );
};
