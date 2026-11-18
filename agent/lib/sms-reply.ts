import twilio from "twilio";
import type { AuthResult } from "eve/channels/auth";
import { CONNECT_USER_ISSUER } from "../../shared/connect";
import { fetchPhoneLink } from "./phone-internal";

export async function sendSmsReply(caller: AuthResult | null, reply: string) {
  if (caller?.issuer !== CONNECT_USER_ISSUER || caller.principalType !== "user") return;

  // Only the signature-checked Twilio ingress sets these per-turn attributes.
  // Web messages supply the same account identity without an SMS destination.
  const number = caller.attributes?.sms_recipient;
  const binding = caller.attributes?.sms_binding;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sender = process.env.EVE_SMS_NUMBER;
  const messagingServiceSid = process.env.EVE_SMS_MESSAGING_SERVICE_SID;
  if (typeof number !== "string" || typeof binding !== "string" || !accountSid || !token
    || !sender || !messagingServiceSid || process.env.EVE_SMS_ENABLED !== "true") return;

  const link = await fetchPhoneLink(number, "sms");
  if (link?.appUserId !== caller.principalId || link.verifiedAt !== binding) return;

  const text = reply.trim();
  if (!text) return;
  const body = text.length > 1500 ? `${text.slice(0, 1499).trimEnd()}…` : text;
  await twilio(accountSid, token).messages.create({ from: sender, to: number, messagingServiceSid, body });
}
