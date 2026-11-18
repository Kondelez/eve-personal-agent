import { phoneLinkQuerySchema } from "~~/server/schemas/phone";
import { getPhoneLinkByPhoneNumber, getSmsLinkByPhoneNumber } from "~~/server/utils/phone-links";
import { requireInternalRequest } from "~~/server/utils/internal-api";

export default defineEventHandler(async (event) => {
  requireInternalRequest(event);

  const { phoneNumber, channel } = await getValidatedQuery(event, phoneLinkQuerySchema.parse);
  const link = channel === "sms"
    ? await getSmsLinkByPhoneNumber(phoneNumber)
    : await getPhoneLinkByPhoneNumber(phoneNumber);

  return { link: link ?? null };
});
