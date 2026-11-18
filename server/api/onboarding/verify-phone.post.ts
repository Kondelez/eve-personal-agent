import { checkPhoneVerificationSchema } from "~~/server/schemas/phone";
import { checkPhoneVerification, requirePhoneVerificationRequest } from "~~/server/utils/phone-verification";
import { requireSignedInUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  requirePhoneVerificationRequest(event);
  const userId = await requireSignedInUserId(event);
  const { code } = await readValidatedBody(event, checkPhoneVerificationSchema.parse);
  await checkPhoneVerification(userId, code, true);
  return { ok: true };
});
