"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, MailX, Copy, Check } from "lucide-react";
import { useGetUserIsGmail } from "@/features/user/use-get-user-isGmail";
import { useState, type ReactNode } from "react";

interface UnsubscribeFailedDialogProps {
  open: boolean;
  onClose: () => void;
  domain: string;
}

const OUTLOOK_BLOCK_URL =
  "https://outlook.live.com/mail/0/options/mail/junkEmail";

// Opens Gmail search pre-filtered to this domain.
// From results, user clicks the sliders icon → "Create filter with this search"
const getGmailSearchUrl = (domain: string) =>
  `https://mail.google.com/mail/u/0/#search/from%3A(%40${encodeURIComponent(domain)})`;

// Emphasised inline text inside the muted step copy.
const Em = ({ children }: { children: ReactNode }) => (
  <span className="font-medium text-foreground">{children}</span>
);

export function UnsubscribeFailedDialog({
  open,
  onClose,
  domain,
}: UnsubscribeFailedDialogProps) {
  const { data: providerData, isLoading } = useGetUserIsGmail();
  const isGmail = (providerData as any)?.is_gmail ?? true;
  const [copied, setCopied] = useState(false);

  const fromQuery = `@${domain}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fromQuery);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const blockUrl = isGmail ? getGmailSearchUrl(domain) : OUTLOOK_BLOCK_URL;

  const steps: ReactNode[] = isGmail
    ? [
        <>
          In the search bar, click the <Em>sliders</Em> (search options) icon.
        </>,
        <>
          Choose <Em>Create filter with this search</Em>.
        </>,
        <>
          Tick <Em>Delete it</Em>, then click <Em>Create filter</Em>.
        </>,
      ]
    : [
        <>
          Open <Em>Junk email → Blocked senders</Em>.
        </>,
        <>
          Add <Em>{domain}</Em> to the list and save.
        </>,
      ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="text-left sm:max-w-md">
        <DialogHeader className="text-left">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              <MailX className="h-[18px] w-[18px]" />
            </span>
            <DialogTitle className="text-base leading-snug">
              Couldn&apos;t unsubscribe automatically
            </DialogTitle>
          </div>
          <DialogDescription className="pt-1 text-sm leading-relaxed">
            Emails from{" "}
            <span className="font-medium text-foreground">{domain}</span> don&apos;t
            offer a one-click unsubscribe.{" "}
            {isGmail
              ? "Here’s how to filter them out in Gmail:"
              : "Block the sender in Outlook to stop them:"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <ol className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-background text-[11px] font-semibold text-foreground"
                >
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {step}
                </span>
              </li>
            ))}
          </ol>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {isGmail ? "Sender" : "Sender to block"}
            </span>
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? "Copied sender" : `Copy ${fromQuery}`}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1 font-mono text-xs text-foreground transition-colors hover:bg-accent cursor-pointer"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-600 dark:text-green-500" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
              <span className="max-w-[180px] truncate">
                {copied ? "Copied" : fromQuery}
              </span>
            </button>
          </div>
        </div>

        <DialogFooter>
          {isLoading ? (
            <div className="h-9 w-full rounded-md bg-muted animate-pulse sm:w-44" />
          ) : (
            <Button asChild className="w-full sm:w-auto">
              <a href={blockUrl} target="_blank" rel="noopener noreferrer">
                {isGmail ? "Open Gmail search" : "Open Outlook settings"}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
