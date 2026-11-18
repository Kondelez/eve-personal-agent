import { startPhoneVerificationSchema } from "~~/server/schemas/phone";
import { requirePhoneVerificationRequest, startPhoneVerification } from "~~/server/utils/phone-verification";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const userId = await requireSessionUserId(event);
  requirePhoneVerificationRequest(event);
  const input = await readValidatedBody(event, startPhoneVerificationSchema.parse);
  await startPhoneVerification(userId, input);
  return { ok: true };
});
