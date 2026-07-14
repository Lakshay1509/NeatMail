"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Label for the action button. Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Runs when the user confirms. Kept fire-and-forget so callers can either
   * close immediately (optimistic mutations) or pass `isLoading` and close in
   * their own onSuccess.
   */
  onConfirm: () => void;
  /**
   * While true the dialog stays open, the confirm button spins, and Escape /
   * Cancel are blocked so an in-flight destructive action can't be interrupted.
   */
  isLoading?: boolean;
  /** Confirm button style. Destructive by default since this gates risky ops. */
  variant?: "destructive" | "default";
  /** Optional glyph shown left of the title (e.g. a lucide icon). */
  icon?: React.ReactNode;
}

/**
 * Reusable confirm-or-cancel dialog for destructive actions. Built on the
 * AlertDialog primitive (no outside-click dismissal), it is the single place
 * team/org destructive flows — revoke invite, remove member, pause access,
 * leave team — go through, so their copy and affordances stay consistent.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  isLoading = false,
  variant = "destructive",
  icon,
}: ConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      // Don't let Escape close the dialog mid-request.
      onOpenChange={(next) => {
        if (isLoading && !next) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {icon}
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>{cancelLabel}</AlertDialogCancel>
          {/* Plain Button (not AlertDialogAction) so it never auto-closes —
              the caller decides when to dismiss, letting us keep it open with a
              spinner while the mutation runs and stay open on error. */}
          <Button
            variant={variant}
            disabled={isLoading}
            onClick={onConfirm}
            className="min-w-24"
          >
            {isLoading ? <Loader2 className="animate-spin" /> : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
