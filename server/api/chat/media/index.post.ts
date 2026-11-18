import { z } from "zod";
import { CHAT_MEDIA_ID, MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, WEB_CHAT_TYPES } from "#shared/chat-media";
import { saveChatMedia } from "~~/server/utils/chat-media";
import { requireSessionUserId } from "~~/server/utils/session";
import { requireChatJson } from "~~/server/utils/chat-request";

const bodySchema = z.object({
  files: z.array(z.object({
    id: z.string().regex(CHAT_MEDIA_ID),
    filename: z.string().trim().min(1).max(180).refine(name => ![...name].some(c => c < " " || c === "/" || c === "\\" || c.charCodeAt(0) === 127)),
    mediaType: z.enum(WEB_CHAT_TYPES),
    data: z.base64().min(4).max(MAX_CHAT_FILE_BYTES * 4 / 3),
  })).min(1).max(MAX_CHAT_FILES),
});

export default defineEventHandler(async (event) => {
  requireChatJson(event);
  const userId = await requireSessionUserId(event);
  const contentLength = Number(getRequestHeader(event, "content-length") ?? 0);
  if (contentLength > MAX_CHAT_FILE_BYTES * 4 / 3 + 8_192) {
    throw createError({ statusCode: 413, statusMessage: "Attachments can total up to 3 MB per message" });
  }
  const { files } = await readValidatedBody(event, bodySchema.parse);
  const prepared = files.map(({ data, ...file }) => ({ ...file, bytes: Buffer.from(data, "base64") }));

  if (prepared.reduce((total, file) => total + file.bytes.length, 0) > MAX_CHAT_FILE_BYTES) {
    throw createError({ statusCode: 413, statusMessage: "Attachments can total up to 3 MB per message" });
  }

  await saveChatMedia(userId, prepared);
  return { saved: true };
});
