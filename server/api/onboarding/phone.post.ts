import { onboardingDetailsSchema } from "~~/server/schemas/onboarding";
import { startPhoneVerificationSchema } from "~~/server/schemas/phone";
import { getOnboardingProfile } from "~~/server/utils/onboarding";
import { requirePhoneVerificationRequest, startPhoneVerification } from "~~/server/utils/phone-verification";
import { requireSignedInUserId } from "~~/server/utils/session";

const bodySchema = startPhoneVerificationSchema.extend(onboardingDetailsSchema.shape);

export default defineEventHandler(async (event) => {
  requirePhoneVerificationRequest(event);
  const userId = await requireSignedInUserId(event);
  const { name, phoneNumber, smsConsent } = await readValidatedBody(event, bodySchema.parse);
  const profile = await getOnboardingProfile(userId);
  if (!profile?.emailVerified || profile.phoneVerified) {
    throw createError({ statusCode: 409, statusMessage: "Refresh the page to check your profile." });
  }
  await startPhoneVerification(userId, { phoneNumber, smsConsent, onboardingName: name });
  return { ok: true };
});
