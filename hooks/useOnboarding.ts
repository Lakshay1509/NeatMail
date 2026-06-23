import { useUser } from "@clerk/nextjs";

export function useOnboarding() {
  const { user } = useUser();

  const saveStep = async (data: Record<string, unknown>) => {
    await user?.update({
      unsafeMetadata: {
        ...user.unsafeMetadata,
        onboarding: {
          ...(user.unsafeMetadata as Record<string, unknown> | undefined)
            ?.onboarding as Record<string, unknown> | undefined,
          ...data,
        },
      },
    });
  };

  return { saveStep };
}
