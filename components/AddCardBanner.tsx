"use client";

import { CreditCard } from "lucide-react";
import posthog from "posthog-js";
import { Button } from "@/components/ui/button";
import { useUpsell } from "@/providers/UpsellProvider";
import { useTierAccess } from "@/features/user/use-tier-access";
import { useGetUserSubscribed } from "@/features/user/use-get-subscribed";
import { useGetTeam } from "@/features/organization/use-get-team";

// Shown to users who took "I'll add my card later" out of onboarding. They land
// on a dashboard that looks finished but sorts nothing, and read that silence as
// a broken setup. So the line leads with the setup being saved, then names the
// one step left. Not dismissible: it is the answer to "did it work?", and it
// disappears the moment a card exists.
const AddCardBanner = () => {
  const { isFree, isResolved } = useTierAccess();

  // An unresolved tier reads as FREE — gate on isResolved or paying users see this flash.
  if (!isResolved || !isFree) return null;
  return <AddCardBannerContent />;
};

const AddCardBannerContent = () => {
  const { data: sub } = useGetUserSubscribed();
  const { data: team } = useGetTeam();
  const { openUpsell } = useUpsell();

  // Checkout is done, the webhook just hasn't landed. Asking again here would
  // read as the payment having failed.
  if (sub?.paymentProcessing) return null;

  // Members get a 403 from POST /api/checkout — tell them who to ask, no CTA.
  const isMember = team?.role === "member";

  // Server-resolved (lib/subscription) — don't offer a trial that already lapsed.
  const trialEligible = sub?.trialEligible === true;

  // One line, built as a whole string rather than interpolated into JSX — a
  // ternary whose arms hold different TextNode counts is the shape that crashes
  // React under in-browser translate (lib/translate-guard.ts).
  //
  // The trial is named by the button, not repeated here, so the sentence carries
  // only what the button cannot: the setup is safe, and why a card is asked for.
  // An earlier draft also promised to "sync your inbox history", which oversold
  // it — activateMailbox backfills `newer_than:14d` capped at 500 messages.
  const line = isMember
    ? "Your labels are saved. Sorting starts once your admin adds a card."
    : trialEligible
      ? "Your labels are saved. Add a card to confirm it's you."
      : "Your labels are saved. Add a card to switch sorting back on.";

  return (
    // Differentiated from the cards by surface and density, not by shouting.
    // Every other block on this page is white with a hairline border, so a
    // filled surface with no border is already a different class of object —
    // Shopify reached the same conclusion reworking Polaris banners ("a more
    // contrasting surface eliminates the need for a border outline, and
    // resonates more as an alert"), alongside "tighten up spacing and sizing".
    // A full ink fill did differentiate, but at the cost of dominating a page
    // it is only annotating. Their prototype's thick left border is skipped
    // here: DESIGN.md bans side-stripes.
    <div
      role="status"
      className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200
        flex items-start gap-2.5 rounded-lg bg-muted px-3.5 py-2.5 sm:items-center sm:gap-3"
    >
      {/* Baymard: an icon gives the message type a second, colour-independent
          signal. Bare glyph, not the bordered 36px chip it was — that chip was
          card furniture, and it cost the text 48px of wrapping width. */}
      <CreditCard
        className="mt-0.5 size-4 shrink-0 text-muted-foreground sm:mt-0"
        aria-hidden="true"
      />

      {/* The button lives in the text's column, not beside the icon, so the
          message and the action share one left edge when this stacks. */}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className="min-w-0 text-sm leading-snug text-foreground">{line}</p>

        {!isMember && (
          // Adobe Spectrum keeps the action inline on an alert banner. Sized to
          // its label rather than the full width: a full-bleed fill under two
          // short lines outweighs the message it is attached to, and reads as a
          // promo card. h-9 on touch, h-8 from sm up where a pointer does not
          // need the extra 4px.
          <Button
            size="sm"
            onClick={() => {
              posthog.capture("add_card_banner_clicked", { trialEligible });
              openUpsell("add_card_banner");
            }}
            className="h-9 sm:h-8 sm:shrink-0"
          >
            {trialEligible ? "Start free trial" : "Add card"}
          </Button>
        )}
      </div>
    </div>
  );
};

export default AddCardBanner;
