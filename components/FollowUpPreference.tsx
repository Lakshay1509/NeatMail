"use client";

import { useState, useEffect } from "react";
import { useGetFollowUpPreferences } from "@/features/follow-up/use-get-follow-up-preferences";
import { usePostFollowUpPreferences } from "@/features/follow-up/use-post-follow-up-preferences";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

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
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
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
      <div className="flex items-start justify-between space-x-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Enable Follow-ups
          </h2>
          <p className="text-gray-600 text-sm max-w-2xl">
            Automatically detect sent emails that need a reply and create
            friendly follow-up drafts after a few days.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-sm font-medium text-gray-700">
            {enabled ? "Active" : "Inactive"}
          </span>
          <Checkbox
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(!!checked)}
            className="w-5 h-5 border-gray-300"
          />
        </div>
      </div>

      {/* AI Drafts */}
      <div className="flex items-start justify-between space-x-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Create AI Drafts
          </h2>
          <p className="text-gray-600 text-sm  max-w-2xl">
            When a follow-up is needed, automatically create a draft reply in
            the same thread using AI.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-sm font-medium text-gray-700">
            {aiDrafts ? "On" : "Off"}
          </span>
          <Checkbox
            checked={aiDrafts}
            onCheckedChange={(checked) => setAiDrafts(!!checked)}
            className="w-5 h-5 border-gray-300"
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
      <Button
        size="sm"
        onClick={handleSubmit}
        disabled={mutation.isPending || isLoading}
      >
        Update preferences
      </Button>
    </div>
  );
};

export default FollowUpPreference;
