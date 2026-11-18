import { z } from "zod";

export const phoneLinkQuerySchema = z.object({
  phoneNumber: z.coerce.string().trim().min(1, "phoneNumber is required"),
  channel: z.literal("sms").optional(),
});

export const startPhoneVerificationSchema = z.object({
  phoneNumber: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
  smsConsent: z.boolean(),
});

export const checkPhoneVerificationSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
});
