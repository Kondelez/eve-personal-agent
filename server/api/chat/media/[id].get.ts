import { CHAT_MEDIA_ID } from "#shared/chat-media";
import { getChatMedia } from "~~/server/utils/chat-media";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const userId = await requireSessionUserId(event);
  const id = getRouterParam(event, "id") ?? "";
  const file = CHAT_MEDIA_ID.test(id) ? await getChatMedia(userId, id) : undefined;
  if (!file) throw createError({ statusCode: 404, statusMessage: "Attachment not found" });

  const inline = file.mediaType.startsWith("image/") || file.mediaType.startsWith("audio/");
  const name = encodeURIComponent(file.filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": file.mediaType,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  });
  const bytes = new Uint8Array(file.bytes);
  const range = getRequestHeader(event, "range");
  if (!range) {
    headers.set("content-length", String(bytes.length));
    return new Response(bytes, { headers });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const suffix = !match?.[1] && match?.[2];
  const start = suffix ? Math.max(0, bytes.length - Number(suffix)) : Number(match?.[1]);
  const end = match?.[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
  if (!match || (!match[1] && !match[2]) || start > end || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    headers.set("content-range", `bytes */${bytes.length}`);
    return new Response(null, { status: 416, headers });
  }

  headers.set("content-range", `bytes ${start}-${end}/${bytes.length}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
});
