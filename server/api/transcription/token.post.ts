import { gateway } from "ai";
import { DICTATION_MODEL } from "#shared/chat-dictation";
import { requireChatJson } from "~~/server/utils/chat-request";
import { requireSessionUserId } from "~~/server/utils/session";
import { reserveDictationRequest } from "~~/server/utils/dictation-rate-limit";

export default defineEventHandler(async (event) => {
  requireChatJson(event);
  const userId = await requireSessionUserId(event);
  await reserveDictationRequest(userId, "live");

  try {
    return await gateway.experimental_transcription.getToken({
      model: DICTATION_MODEL,
      expiresAfterSeconds: 180,
    });
  }
  catch (error) {
    const status = (error as { statusCode?: number } | undefined)?.statusCode;
    console.warn("Live dictation token unavailable", { status });
    throw createError({ statusCode: 502, statusMessage: "Live transcription is temporarily unavailable" });
  }
});
