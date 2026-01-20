"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle } from "lucide-react";
import { SignOutButton, useUser } from "@clerk/nextjs";

interface PermissionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missingScopes?: string[];
}

export function PermissionsModal({
  open,
  onOpenChange,
  missingScopes = [],
}: PermissionsModalProps) {
  



  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-yellow-100 p-3">
              <AlertTriangle className="h-6 w-6 text-yellow-600" />
            </div>
            <DialogTitle className="text-xl">
              Gmail Permissions Required
            </DialogTitle>
          </div>
          <DialogDescription className="text-base pt-4">
            To use the NeatMail, we need additional permissions to
            access and organize your emails.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <p className="text-sm font-medium mb-3">Required permissions:</p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="text-primary mt-0.5">•</span>
              <span>Read and apply labels to emails</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="text-primary mt-0.5">•</span>
              <span>Create and manage email labels</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="text-primary mt-0.5">•</span>
              <span>Read email metadata (labels, read status)</span>
            </li>
            <li className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="text-primary mt-0.5">•</span>
              <span>Compose drafts</span>
            </li>
          </ul>
        </div>
        <div>
            <p className="text-sm font-semibold">Please logout and login with all the scopes required!</p>
        </div>

        <DialogFooter>

          <SignOutButton>
            <Button>
                Sign Out
            </Button>
          </SignOutButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}