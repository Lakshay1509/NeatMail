"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SubscriptionModal } from "./SubscriptionModal";

const steps = [
  {
    title: "Welcome to NeatMail",
    description: "We're glad you're here. We'll quickly walk you through the core setup so you can start organizing your inbox right away.",
    type: "video" as const,
    videoUrl: "https://res.cloudinary.com/backend-15/video/upload/v1774241159/neatmail/animate_this_logo_fn4hzq.mp4",
  },
  {
    title: "Choose labels for your workflow",
    description: "Pick the labels NeatMail should use when classifying emails so messages land exactly where you want them.",
    type: "video" as const,
    videoUrl: "https://res.cloudinary.com/backend-15/video/upload/v1774240425/neatmail/label_kwk2zm.mp4",
  },
  {
    title: "Set draft preferences",
    description: "Set how AI-generated drafts should sound, so replies match your preferred tone, style, and level of detail.",
    type: "video" as const,
    videoUrl: "https://res.cloudinary.com/backend-15/video/upload/v1774242781/neatmail/draft_nhhlfj.mp4",
  },
  {
    title: "Unsubscribe from annoying senders",
    description: "Remove clutter in one click by unsubscribing from noisy senders.",
    type: "video" as const,
    videoUrl: "https://res.cloudinary.com/backend-15/video/upload/v1774240424/neatmail/unsubscribe_z9pdd4.mp4",
  },
];

const WelcomeDialog = () => {
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);

  useEffect(() => {
    const hasVisited = localStorage.getItem("welcome_dialog_seen");
    if (!hasVisited) {
      setOpen(true);
    }
  }, []);

  const handleClose = () => {
    setOpen(false);
    localStorage.setItem("welcome_dialog_seen", "true");
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      handleClose();
      setIsSubscriptionOpen(true);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  const step = steps[currentStep];

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-xl p-0 gap-0 overflow-hidden">
          <div className="p-6 pb-0">
            <DialogTitle className="text-xl font-semibold">{step.title}</DialogTitle>
            <p className="text-sm text-muted-foreground mt-2">{step.description}</p>
          </div>

          {step.type === "video" && (
            <div className="px-6 pt-4">
              <div className="rounded-lg overflow-hidden bg-muted aspect-video">
                <video
                  key={currentStep}
                  className="w-full h-full object-contain"
                  autoPlay
                  muted
                  loop
                  playsInline
                >
                  <source src={step.videoUrl} type="video/mp4" />
                </video>
              </div>
            </div>
          )}

          {/* {step.type === "text" && (
          <div className="px-6 pt-4">
            <div className="rounded-lg bg-muted aspect-video flex items-center justify-center">
              <span className="text-4xl">👋</span>
            </div>
          </div>
        )} */}

          <div className="flex items-center justify-between p-6">
            {/* Dots */}
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentStep(i)}
                  className={`w-2 h-2 rounded-full transition-all duration-200 ${
                    i === currentStep
                      ? "bg-primary w-5"
                      : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                  aria-label={`Go to step ${i + 1}`}
                />
              ))}
            </div>

            {/* Navigation */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                disabled={currentStep === 0}
                className="gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                Prev
              </Button>
              <Button size="sm" onClick={handleNext} className="gap-1">
                {currentStep === steps.length - 1 ? "Get Started" : "Next"}
                {currentStep < steps.length - 1 && <ChevronRight className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <SubscriptionModal
        open={isSubscriptionOpen}
        onOpenChange={setIsSubscriptionOpen}
      />
    </>
  );
};

export default WelcomeDialog;
