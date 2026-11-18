import { disableSmsForAppUser } from "~~/server/utils/phone-links";
import { requirePhoneVerificationRequest } from "~~/server/utils/phone-verification";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const userId = await requireSessionUserId(event);
  requirePhoneVerificationRequest(event);
  await disableSmsForAppUser(userId);
  return { ok: true };
});
