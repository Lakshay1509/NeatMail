"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Infinity, Sparkles, Sliders, Tag, Loader2, Settings } from "lucide-react";
import { toast } from "sonner";

interface SubscriptionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SubscriptionModal = ({
  open,
  onOpenChange,
}: SubscriptionModalProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handlebilling = async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/freeTrial/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (response.ok) {
        toast.success("Free trial activated successfully");
        window.location.reload();
      } else {
        toast.error(data.error);
        setError(data.error || "Something went wrong");
      }
    } catch (_err) {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    {
      icon: Infinity,
      title: "Unlimited email tracking",
      desc: "No limits on email volume or labels.",
    },
    {
      icon: Tag,
      title: "Gmail and Outlook labels",
      desc: "Labels sync directly to your Gmail and Outlook inbox.",
    },
    {
      icon: Sliders,
      title: "Custom smart labels",
      desc: "Choose the labels that matter to your workflow.",
    },
    {
      icon: Sparkles,
      title: "AI draft replies",
      desc: "AI generates draft responses for emails that need a reply.",
    },
    {
      icon: Settings,
      title: "Full customization",
      desc: "Tailor the app to fit how you already work.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-md rounded-2xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-xl font-semibold font-[family-name:var(--font-logo)]">
            Start your free trial
          </DialogTitle>
          <DialogDescription className="text-balance">
            All features unlocked for 7 days, no card required.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border bg-secondary/50">
          <div className="divide-y divide-border">
            {features.map((feature, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <feature.icon className="mt-px h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <h4 className="text-sm font-medium">{feature.title}</h4>
                  <p className="text-xs text-muted-foreground">
                    {feature.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {error && (
            <p className="text-center text-xs font-medium text-destructive">
              {error}
            </p>
          )}

          <Button onClick={handlebilling} disabled={isLoading} className="w-full">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Activating trial&hellip;
              </>
            ) : (
              <>
                Start free trial
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
