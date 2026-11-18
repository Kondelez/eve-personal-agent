import { z } from "zod";
import { isPhoneAccountEmail, isProfileName } from "#shared/sign-in";

export const onboardingDetailsSchema = z.object({
  name: z.string().trim().refine(isProfileName, "Enter your name."),
  smsConsent: z.literal(true),
});

export const onboardingEmailSchema = onboardingDetailsSchema.extend({
  email: z.string().trim().toLowerCase().pipe(z.email()).refine(email => !isPhoneAccountEmail(email), "Enter your email address."),
  redirect: z.string().optional(),
});
