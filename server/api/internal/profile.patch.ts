import { z } from "zod";
import { patchProfileBodySchema } from "~~/server/schemas/profile";
import { getOnboardingProfile } from "~~/server/utils/onboarding";
import { updateProfileForUser } from "~~/server/utils/profile";
import { requireInternalRequest } from "~~/server/utils/internal-api";

const bodySchema = z.object({
  userId: z.string().trim().min(1),
  patch: patchProfileBodySchema.omit({ phoneNumber: true }).strict().refine(
    patch => Object.keys(patch).length > 0,
    "Provide at least one profile field.",
  ),
});

export default defineEventHandler(async (event) => {
  requireInternalRequest(event);
  const { userId, patch } = await readValidatedBody(event, bodySchema.parse);
  if (!(await getOnboardingProfile(userId))?.complete) {
    throw createError({ statusCode: 403, statusMessage: "Complete your profile first." });
  }
  return { profile: await updateProfileForUser(userId, patch) };
});
