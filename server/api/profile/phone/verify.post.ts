import { checkPhoneVerificationSchema } from "~~/server/schemas/phone";
import { checkPhoneVerification, requirePhoneVerificationRequest } from "~~/server/utils/phone-verification";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const userId = await requireSessionUserId(event);
  requirePhoneVerificationRequest(event);
  const { code } = await readValidatedBody(event, checkPhoneVerificationSchema.parse);
  await checkPhoneVerification(userId, code);
  return { ok: true };
});
