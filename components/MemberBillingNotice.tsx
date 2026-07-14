"use client";

import Link from "next/link";
import Avatar from "boring-avatars";
import { motion, useReducedMotion } from "framer-motion";
import { ShieldCheck, Mail, Check, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTierAccess } from "@/features/user/use-tier-access";
import type { Tier } from "@/lib/tiers";

// Same palette as the team page avatars, for visual consistency with /organization.
const AVATAR_COLORS = ["#4f46e5", "#7c3aed", "#2563eb", "#0ea5e9", "#a5b4fc"];

// Mirrors AppSidebar's TIER_COLORS (amber Max, blue Pro). Deliberately the
// only color on the page, confined to the plan card below.
const TIER_COLORS: Record<Tier, string> = {
  FREE: "#6b7280",
  PRO: "#2563eb",
  MAX: "#d97706",
};

const TIER_LABELS: Record<Tier, string> = {
  FREE: "Free",
  PRO: "Pro",
  MAX: "Max",
};

// Shown on /billing to a non-owner teammate instead of pricing/checkout
// (which the server rejects for them). Shows their plan, benefits, and admin contact.
export function MemberBillingNotice({
  adminEmail,
  teamName,
}: {
  adminEmail: string | null;
  teamName: string;
}) {
  const { tier, isFree, limits } = useTierAccess();
  const reduceMotion = useReducedMotion();

  const mailto = adminEmail
    ? `mailto:${adminEmail}?subject=${encodeURIComponent(
        "NeatMail billing question",
      )}`
    : undefined;

  const planLabel = isFree ? "Team plan" : `${TIER_LABELS[tier]} plan`;
  const planColor = isFree ? "#9ca3af" : TIER_COLORS[tier];

  // Benefits derived from the live tier, ordered most-persuasive first.
  const highlights = isFree
    ? []
    : [
        limits.maxAiDraftsPerMonth === Infinity
          ? "Unlimited AI drafts"
          : `${limits.maxAiDraftsPerMonth} AI drafts / month`,
        "Unlimited emails & labels",
        limits.hasAdvancedAnalytics ? "Advanced analytics" : "Smart daily digest",
        limits.hasPrioritySupport ? "Priority support" : "Telegram & Slack",
      ];

  const content = (
    <div className="flex w-full max-w-md flex-col items-center text-center">
      {/* Emblem is deliberately achromatic; plan color lives in the pass below */}
      <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-b from-secondary to-muted text-foreground shadow-sm ring-1 ring-border">
        <ShieldCheck size={26} strokeWidth={1.75} aria-hidden="true" />
      </div>

      <span className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-foreground/45">
        Team membership
      </span>
      <h1 className="mt-2 font-logo text-2xl font-semibold leading-tight tracking-tight text-balance text-foreground">
        You&apos;re covered
      </h1>
      {/* foreground/70 (~5.5:1 on white); muted-foreground fails the 4.5:1 body floor */}
      <p className="mt-2.5 max-w-sm text-sm leading-relaxed text-foreground/70">
        Billing and seats for{" "}
        <span className="font-medium text-foreground">{teamName}</span> are
        handled by your admin. You already have full access to everything on the{" "}
        <span className="font-medium text-foreground">{planLabel}</span> —
        nothing to set up here.
      </p>

      <div className="mt-8 w-full overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm">
        <div
          className="flex items-start justify-between gap-3 px-5 py-4"
          style={isFree ? undefined : { backgroundColor: `${planColor}12` }}
        >
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="mt-[5px] size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: planColor }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-logo text-base font-semibold leading-tight text-foreground">
                {planLabel}
              </p>
              <p className="mt-0.5 text-xs text-foreground/60">
                Full access, shared with your team
              </p>
            </div>
          </div>

          {!isFree && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground/70">
              <span className="relative flex size-1.5" aria-hidden="true">
                {!reduceMotion && (
                  <span
                    className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
                    style={{ backgroundColor: planColor }}
                  />
                )}
                <span
                  className="relative inline-flex size-1.5 rounded-full"
                  style={{ backgroundColor: planColor }}
                />
              </span>
              Active
            </span>
          )}
        </div>

        {highlights.length > 0 && (
          <>
            <div className="border-t border-border" />
            <ul className="grid grid-cols-1 gap-x-4 gap-y-2.5 px-5 py-4 sm:grid-cols-2">
              {highlights.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <Check
                    size={14}
                    strokeWidth={2.5}
                    className="shrink-0 text-foreground/35"
                    aria-hidden="true"
                  />
                  <span className="text-sm leading-tight text-foreground/80">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="mt-4 w-full divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card text-left">
        <div className="flex items-center gap-3 px-5 py-4">
          <span className="flex size-9 shrink-0 overflow-hidden rounded-full ring-1 ring-border">
            <Avatar
              name={adminEmail || teamName}
              variant="beam"
              size={36}
              colors={AVATAR_COLORS}
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {adminEmail ?? "Your team owner"}
            </p>
            <p className="mt-0.5 text-xs text-foreground/60">
              Team admin · manages billing &amp; seats
            </p>
          </div>
          {mailto && (
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <a href={mailto}>
                <Mail aria-hidden="true" /> Contact
              </a>
            </Button>
          )}
        </div>

        <Link
          href="/organization"
          className="group flex items-center justify-between px-5 py-3.5 text-sm font-medium text-foreground/80 transition-colors hover:bg-secondary/60 hover:text-foreground"
        >
          <span>View team members</span>
          <ChevronRight
            size={16}
            className="text-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground/70"
            aria-hidden="true"
          />
        </Link>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[calc(100dvh-7rem)] items-center justify-center px-1 py-8">
      {reduceMotion ? (
        content
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="flex w-full justify-center"
        >
          {content}
        </motion.div>
      )}
    </div>
  );
}
