"use client";

import { useState, useEffect } from "react";
import { useGetDigestPreferences } from "@/features/digest/use-get-digest-preferences";
import { usePostDigestPreferences } from "@/features/digest/use-post-digest-preferences";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

function generateTimeSlots() {
  const slots: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h < 12 ? "AM" : "PM";
      const label = `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
      slots.push({ value, label });
    }
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();


export default function DigestSettings() {
  const { data, isLoading } = useGetDigestPreferences();
  const postPreferences = usePostDigestPreferences();

  const [enabled, setEnabled] = useState(false);
  const [deliveryTime, setDeliveryTime] = useState("09:00");
  const [hasChanges, setHasChanges] = useState(false);
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    if (data?.preference) {
      setEnabled(data.preference.enabled);
      setDeliveryTime(data.preference.delivery_time);
      setHasChanges(false);
    }
  }, [data]);

  const handleSave = () => {
    const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    postPreferences.mutate({
      enabled,
      deliveryTime,
      timezone:userTimezone,
    });
    setHasChanges(false);
  };

  const handleTest = async () => {
    setTestSending(true);
    try {
      const response = await fetch("/api/digest/test", {
        method: "POST",
      });
      if (response.ok) {
        toast.success("Test digest sent to your email");
      } else {
        toast.error("Failed to send test digest");
      }
    } catch {
      toast.error("Failed to send test digest");
    } finally {
      setTestSending(false);
    }
  };

  const onFieldChange = (callback: () => void) => {
    callback();
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <div className="">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Daily Digest</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your morning briefing, delivered on your terms
        </p>
      </div>

      <Separator />

      <div className="flex items-start justify-between py-6">
        <div className="space-y-1">
          <p className="text-base font-semibold">Enable daily digest</p>
          <p className="text-sm text-muted-foreground">
            Receive a curated morning briefing
          </p>
        </div>
        <Checkbox
          id="enable-digest"
          checked={enabled}
          onCheckedChange={(v) => onFieldChange(() => setEnabled(!!v))}
          className="mt-1"
        />
      </div>

      <Separator />

      <div className="flex items-start justify-between py-6 space-x-2">
        <div className="space-y-1">
          <p className="text-base font-semibold">Delivery time</p>
          <p className="text-sm text-muted-foreground">
            When to prepare your briefing
          </p>
        </div>
        <Select
          value={deliveryTime}
          onValueChange={(v) => onFieldChange(() => setDeliveryTime(v))}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="09:00" />
          </SelectTrigger>
          <SelectContent>
            {TIME_SLOTS.map((slot) => (
              <SelectItem key={slot.value} value={slot.value}>
                {slot.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="flex items-center justify-between pt-6">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testSending}
        >
          Send test digest
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || postPreferences.isPending}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}
