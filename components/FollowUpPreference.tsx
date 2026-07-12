"use client";

import { useState, useEffect } from "react";
import { useGetFollowUpPreferences } from "@/features/follow-up/use-get-follow-up-preferences";
import { usePostFollowUpPreferences } from "@/features/follow-up/use-post-follow-up-preferences";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

const FollowUpPreference = () => {
  const { data, isLoading, isError } = useGetFollowUpPreferences();
  const mutation = usePostFollowUpPreferences();

  const [enabled, setEnabled] = useState(false);
  const [aiDrafts, setAiDrafts] = useState(true);
  const [days, setDays] = useState(3);
  const [skipEmails, setSkipEmails] = useState("");

  useEffect(() => {
    if (data?.preference) {
      setEnabled(data.preference.enabled ?? false);
      setAiDrafts(data.preference.ai_drafts ?? true);
      setDays(data.preference.days ?? 3);
      setSkipEmails(
        (data.preference.skip_emails ?? "").split(",").join("\n"),
      );
    }
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground motion-reduce:animate-none" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Failed to load follow-up preferences. Please try again.
      </div>
    );
  }

  const handleSubmit = async () => {
    await mutation.mutateAsync({
      enabled,
      aiDrafts,
      days,
      skipEmails: skipEmails || "",
    });
  };

  return (
    <div className="space-y-6 w-full max-w-full">
      {/* Enable Follow-ups */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Enable Follow-ups
          </h2>
          <p className="text-muted-foreground text-sm max-w-2xl">
            Automatically detect sent emails that need a reply and create
            friendly follow-up drafts after a few days.
          </p>
        </div>
        <div className="flex items-center gap-2.5 pt-1 shrink-0">
          {enabled && <span className="h-1.5 w-1.5 rounded-full bg-foreground animate-in zoom-in-50 fade-in duration-200 motion-reduce:animate-none" aria-hidden="true" />}
          <span className="text-sm font-medium text-foreground">
            {enabled ? "Active" : "Inactive"}
          </span>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(checked)}
            aria-label="Enable follow-ups"
          />
        </div>
      </div>

      {/* AI Drafts */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Create AI Drafts
          </h2>
          <p className="text-muted-foreground text-sm max-w-2xl">
            When a follow-up is needed, automatically create a draft reply in
            the same thread using AI.
          </p>
        </div>
        <div className="flex items-center gap-2.5 pt-1 shrink-0">
          <span className="text-sm font-medium text-foreground">
            {aiDrafts ? "On" : "Off"}
          </span>
          <Switch
            checked={aiDrafts}
            onCheckedChange={(checked) => setAiDrafts(checked)}
            aria-label="Create AI drafts for follow-ups"
          />
        </div>
      </div>

      {/* Days */}
      <div className="space-y-1.5">
        <Label htmlFor="follow-up-days" className="text-lg font-semibold">
          Wait time (days)
        </Label>
        <p className="text-xs text-muted-foreground">
          How many days to wait before sending a follow-up.
        </p>
        <Input
          id="follow-up-days"
          type="number"
          min={1}
          max={30}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-full"
        />
      </div>

      {/* Skip Emails */}
      <div className="space-y-1.5">
        <Label htmlFor="skip-emails" className="text-lg font-semibold">
          Skip emails
        </Label>
        <p className="text-xs text-muted-foreground">
          Never send follow-ups to these email addresses. One per line.
        </p>
        <Textarea
          id="skip-emails"
          placeholder="support@example.com&#10;noreply@example.com"
          value={skipEmails}
          onChange={(e) => setSkipEmails(e.target.value)}
          rows={4}
          className="resize-none w-full"
        />
      </div>

      {/* Update Button */}
      <div className="border-t border-border pt-4 flex justify-end">
        <Button
          size="sm"
          className="min-w-[150px]"
          onClick={handleSubmit}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Saving…" : "Update preferences"}
        </Button>
      </div>
    </div>
  );
};

export default FollowUpPreference;
