import { getOnboardingProfile } from "~~/server/utils/onboarding";
import { getSignedInUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const userId = await getSignedInUserId(event);
  return { profile: userId ? await getOnboardingProfile(userId) ?? null : null };
});
