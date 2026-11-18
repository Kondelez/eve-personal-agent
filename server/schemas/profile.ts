import { z } from "zod";
import { isProfileName } from "#shared/sign-in";

export const patchProfileBodySchema = z.object({
  name: z.string().trim().refine(isProfileName, "Enter your name.").optional(),
  timezone: z.string().trim().min(1).max(64).refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    }
    catch {
      return false;
    }
  }, "Enter a valid timezone.").optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  bio: z.string().trim().max(500).optional(),
  phoneNumber: z.string().trim().max(20).nullable().optional(),
});
