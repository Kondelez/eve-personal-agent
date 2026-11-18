import type { PhoneLinkRecord } from "../../shared/types/phone-link.js";
import { appOrigin, internalHeaders } from "./internal-api.js";

export async function fetchPhoneLink(phoneNumber: string, channel?: "sms"): Promise<PhoneLinkRecord | undefined> {
  try {
    const query = new URLSearchParams({ phoneNumber });
    if (channel) query.set("channel", channel);
    const response = await fetch(
      `${appOrigin()}/api/internal/phone/link?${query}`,
      { headers: internalHeaders() },
    );

    if (!response.ok) {
      return undefined;
    }

    const { link } = await response.json() as { link: PhoneLinkRecord | null };
    return link ?? undefined;
  }
  catch {
    return undefined;
  }
}
