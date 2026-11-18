import { defineChannel, POST } from "eve/channels";
import twilio from "twilio";
import { buildAppSessionAuth } from "../../shared/app-auth.js";
import { fetchPhoneLink } from "../lib/phone-internal.js";

const SMS_PATH = "/webhooks/twilio/sms";
const E164 = /^\+[1-9]\d{7,14}$/;
const CARRIER_KEYWORD = /^(stop|stopall|unsubscribe|cancel|end|quit|start|unstop|help|info)$/i;

type SmsState = {
  phoneNumber: string;
  appUserId: string;
  verifiedAt: string;
};

export default defineChannel({
  state: null as SmsState | null,
  audience: () => "private",
  turnPolicy: "queue",
  context: state => ({ sms: state }),

  routes: [
    POST<SmsState | null>(SMS_PATH, async (request, { from }) => {
      const token = process.env.TWILIO_AUTH_TOKEN;
      const origin = process.env.BETTER_AUTH_CUSTOM_URL;
      const signature = request.headers.get("x-twilio-signature");
      if (!token || !origin || !signature) return new Response("Unauthorized", { status: 401 });

      const fields = new URLSearchParams(await request.text());
      const params = Object.fromEntries(fields);
      if (Object.keys(params).length !== fields.size
        || !twilio.validateRequest(token, signature, new URL(SMS_PATH, origin).href, params)) {
        return new Response("Unauthorized", { status: 401 });
      }

      const text = params.Body?.trim();
      if (process.env.EVE_SMS_ENABLED !== "true" || params.AccountSid !== process.env.TWILIO_ACCOUNT_SID
        || params.To !== process.env.EVE_SMS_NUMBER || !E164.test(params.From ?? "")
        || !/^SM[0-9a-f]{32}$/i.test(params.MessageSid ?? "")
        || !text || params.OptOutType || CARRIER_KEYWORD.test(text)) {
        return new Response(null, { status: 204 });
      }

      const link = await fetchPhoneLink(params.From, "sms");
      if (!link?.verifiedAt) return new Response(null, { status: 204 });

      const sms = { phoneNumber: link.phoneNumber, appUserId: link.appUserId, verifiedAt: link.verifiedAt };
      // Include the account and binding version so re-linking starts a fresh SMS thread.
      const address = JSON.stringify([sms.appUserId, sms.phoneNumber, sms.verifiedAt]);
      await from(address).send(text, {
        auth: buildAppSessionAuth(sms.appUserId, { phone_number: sms.phoneNumber }),
        idempotencyKey: params.MessageSid,
        title: "SMS",
        state: sms,
      });
      return new Response(null, { status: 204 });
    }),
  ],

  events: {
    async "content.completed"(event, ctx) {
      if (event.data.phase !== "reply" || typeof event.data.value !== "string") return;
      const sms = ctx.channel.sms;
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const number = process.env.EVE_SMS_NUMBER;
      const messagingServiceSid = process.env.EVE_SMS_MESSAGING_SERVICE_SID;
      if (!sms || !accountSid || !token || !number || !messagingServiceSid || process.env.EVE_SMS_ENABLED !== "true") return;

      // Consent or ownership may have changed during the turn.
      const link = await fetchPhoneLink(sms.phoneNumber, "sms");
      if (link?.appUserId !== sms.appUserId || link.verifiedAt !== sms.verifiedAt) return;

      const text = event.data.value.trim();
      if (!text) return;
      const body = text.length > 1500 ? `${text.slice(0, 1499).trimEnd()}…` : text;
      await twilio(accountSid, token).messages.create({ from: number, to: sms.phoneNumber, messagingServiceSid, body });
    },
  },
});
