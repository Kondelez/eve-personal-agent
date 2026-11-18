import { db } from "@nuxthub/db";
import { onboardingDetailsSchema } from "~~/server/schemas/onboarding";
import { finishOnboarding, getOnboardingProfile } from "~~/server/utils/onboarding";
import { requirePhoneVerificationRequest } from "~~/server/utils/phone-verification";
import { requireSignedInUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  requirePhoneVerificationRequest(event);
  const userId = await requireSignedInUserId(event);
  const { name } = await readValidatedBody(event, onboardingDetailsSchema.parse);
  if (!(await getOnboardingProfile(userId))?.complete) {
    const complete = await db.transaction(transaction => finishOnboarding(transaction, userId, name));
    if (!complete) throw createError({ statusCode: 409, statusMessage: "Verify your email and mobile number first." });
  }
  return { ok: true };
});
