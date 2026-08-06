import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { subDays } from "date-fns";
import { db } from "@/lib/prisma";
import Dashboard from "@/components/Dashboard";
import UserLabel from "@/components/UserLabel";
import OnboardingScanToast from "@/components/OnboardingScanToast";
import { PageHeader } from "@/components/PageHeader";

// No labels means onboarding was never finished, so the dashboard must not
// render for that user — not even for a frame. This ran on the client before,
// which meant the page painted (and anything mounted on it fired) before the
// bounce. Reading the same rows /api/tags reads, on the server, makes the
// forward to /onboarding unconditional and flash-free. Onboarding writes at
// least one user_tags row (POST /api/onboard enforces `tags.min(1)`), so a
// completed user can never bounce back here.
export default async function Home() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const labelCount = await db.user_tags.count({ where: { user_id: userId } });
  if (labelCount === 0) redirect("/onboarding");

  // <Dashboard/> hides its two label-based cards when nothing in the visible
  // range carries an AI label, and that decides the column count of both chart
  // rows. Left to the client, the first paint has to guess, so it laid out for
  // two cards and collapsed once the query landed — a new user, whose mail
  // hasn't been classified yet, watched a skeleton appear for a card they were
  // never going to get. Resolving it here removes the guess: this is the same
  // condition /api/stats/labelsThisWeek answers (an email_tracked row carrying a
  // tag_id), over the date picker's default 14-day window, so the skeletons
  // paint at their final width. Existence check only — `findFirst` stops at the
  // first row, on idx_tracked_user_tag.
  const taggedInDefaultRange = await db.email_tracked.findFirst({
    where: {
      user_id: userId,
      tag_id: { not: null },
      created_at: { gte: subDays(new Date(), 14) },
    },
    select: { message_id: true },
  });

  return (
    // No <main> here — SidebarInset already renders one, and its `overflow-auto`
    // used to make itself the scrollport, which would strand the sticky header.
    <>
      <OnboardingScanToast />
      {/* The dashboard is the one page without a title — the bar exists only to
          keep the sidebar reachable on mobile. */}
      <PageHeader />
      <div className="w-full p-6 md:px-10">
        <UserLabel />
        <Dashboard initialHasLabels={taggedInDefaultRange !== null} />
      </div>
    </>
  );
}
