import { z } from "zod";
import { isVerificationPhoneNumber } from "#shared/phone-codes";

export const phoneLinkQuerySchema = z.object({
  phoneNumber: z.coerce.string().trim().min(1, "phoneNumber is required"),
  channel: z.literal("sms").optional(),
});

export const startPhoneVerificationSchema = z.object({
  phoneNumber: z.string().trim().refine(isVerificationPhoneNumber, "Enter a complete mobile number"),
  smsConsent: z.boolean(),
});

export const checkPhoneVerificationSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
});
