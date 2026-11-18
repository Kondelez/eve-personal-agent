import { defineChannel, POST } from "eve/channels";
import { routeAuth } from "eve/channels/auth";
import twilio from "twilio";
import { buildAppSessionAuth } from "../../shared/app-auth.js";
import { ACCOUNT_CHAT_PATH } from "../../shared/types/account-chat";
import { setDetectedTimezone } from "../../server/utils/profile-timezone";
import { authenticateAccount } from "../lib/account-auth";
import { fetchChatMedia } from "../lib/chat-media";
import { isClosedChat, openAccountChat } from "../lib/account-chat";
import { fetchPhoneLink } from "../lib/phone-internal.js";
import { sendSmsReply } from "../lib/sms-reply";
import { storeTwilioAudio, twilioAudioParts } from "../lib/twilio-audio";
import type { MessageContent } from "eve/client";

const SMS_PATH = "/eve/v1/twilio/messages";
const E164 = /^\+[1-9]\d{7,14}$/;
const CARRIER_KEYWORD = /^(stop|stopall|unsubscribe|cancel|end|quit|start|unstop|help|info)$/i;

export default defineChannel({
  audience: () => "private",
  turnPolicy: "queue",
  fetchFile: fetchChatMedia,

  routes: [
    POST(ACCOUNT_CHAT_PATH, async (request, route) => {
      const auth = await routeAuth(request, authenticateAccount);
      if (auth instanceof Response) return auth;

      if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
        return new Response("Expected JSON", { status: 415 });
      }
      const body = await request.json().catch(() => null) as { timezone?: unknown; closedSessionId?: unknown } | null;
      if (typeof body?.timezone === "string" && body.timezone.length <= 64) {
        await setDetectedTimezone(auth.principalId, body.timezone);
      }

      const { sessionId, history } = await openAccountChat(route, auth, {
        preview: true,
        closedSessionId: typeof body?.closedSessionId === "string" ? body.closedSessionId : undefined,
      });
      return Response.json({ sessionId, history }, { headers: { "cache-control": "private, no-store" } });
    }),

    POST(SMS_PATH, async (request, route) => {
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
        || !/^(SM|MM)[0-9a-f]{32}$/i.test(params.MessageSid ?? "")
        || params.OptOutType || CARRIER_KEYWORD.test(text ?? "")) {
        return new Response(null, { status: 204 });
      }

      const audio = twilioAudioParts(params, params.AccountSid!, params.MessageSid!);
      if (!text && !audio.length) return new Response(null, { status: 204 });

      const link = await fetchPhoneLink(params.From, "sms");
      if (!link?.verifiedAt) return new Response(null, { status: 204 });

      const { parts, failed } = await storeTwilioAudio(link.appUserId, params.AccountSid!, token, audio);
      const mediaNote = failed ? "[A voice attachment could not be retrieved.]" : "";
      const messageText = [text, mediaNote].filter(Boolean).join("\n");
      const message: MessageContent = parts.length
        ? [...(messageText ? [{ type: "text" as const, text: messageText }] : []), ...parts]
        : messageText;

      const auth = buildAppSessionAuth(link.appUserId, {});
      const { session } = await openAccountChat(route, auth);
      const options = {
        auth: {
          ...auth,
          attributes: { sms_recipient: link.phoneNumber, sms_binding: link.verifiedAt },
        },
        idempotencyKey: `twilio:${params.MessageSid}`,
        turnPolicy: "queue" as const,
      };
      try {
        await session.send(message, options);
      }
      catch (error) {
        if (!isClosedChat(error)) throw error;
        const { session: recovered } = await openAccountChat(route, auth, { closedSessionId: session.id });
        await recovered.send(message, options);
      }
      return new Response(null, { status: 204 });
    }),
  ],

  events: {
    async "content.completed"(event, ctx) {
      if (event.data.phase === "reply" && typeof event.data.value === "string") {
        await sendSmsReply(ctx.session.auth.current, event.data.value);
      }
    },
  },
});
