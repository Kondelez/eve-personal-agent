import { requireChatOrigin } from "~~/server/utils/chat-request";
import { requireSessionUserId } from "~~/server/utils/session";
import { reserveDictationRequest } from "~~/server/utils/dictation-rate-limit";
import { transcribeAudio } from "~~/server/utils/audio-transcription";

const MAX_BYTES = 3_000_000;
const EXTENSIONS = new Map([
  ["audio/mp4", "mp4"],
  ["video/mp4", "mp4"],
  ["audio/webm", "webm"],
  ["video/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
]);

export default defineEventHandler(async (event) => {
  requireChatOrigin(event);
  const userId = await requireSessionUserId(event);
  const type = getRequestHeader(event, "content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const extension = EXTENSIONS.get(type);
  if (!extension) throw createError({ statusCode: 415, statusMessage: "The browser recorded an unsupported audio format" });

  if (Number(getRequestHeader(event, "content-length")) > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Recording is too large" });
  }
  const bytes = await readRawBody(event, false);
  if (!bytes?.length) throw createError({ statusCode: 400, statusMessage: "The recording was empty" });
  if (bytes.length > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: "Recording is too large" });
  await reserveDictationRequest(userId, "recording");

  try {
    const clip = new Blob([new Uint8Array(bytes)], { type });
    const transcript = await transcribeAudio(clip, `dictation.${extension}`, AbortSignal.timeout(25_000));
    return { transcript };
  }
  catch (error) {
    console.warn("Recorded dictation failed", { type: error instanceof Error ? error.name : "UnknownError" });
    throw createError({ statusCode: 502, statusMessage: "Could not transcribe the recording. Try again" });
  }
});
