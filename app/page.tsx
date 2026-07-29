import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/prisma";
import Dashboard from "@/components/Dashboard";
import UserLabel from "@/components/UserLabel";
import OnboardingScanToast from "@/components/OnboardingScanToast";

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

  return (
    <main className="flex-1 overflow-auto">
      <OnboardingScanToast />
      <div className="w-full p-6 md:px-10">
        <UserLabel />
        <Dashboard />
      </div>

    </main>
  );
}
