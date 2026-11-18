import { createHash } from "node:crypto";
import type { MessageFilePart } from "eve/client";
import { chatMediaReference } from "../../shared/chat-media";
import { getChatMedia, saveChatMedia } from "../../server/utils/chat-media";
import type { StoredChatFile } from "../../server/utils/chat-media";

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/x-m4a": "m4a",
  "audio/amr": "amr",
  "audio/amr-nb": "amr",
  "audio/amr-wb": "awb",
  "audio/3gpp": "3gp",
  "audio/3gpp2": "3g2",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/vnd.wave": "wav",
  "audio/flac": "flac",
  "audio/ac3": "ac3",
  "audio/basic": "au",
};

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tiff",
  "image/bmp": "bmp",
};

const MAX_MEDIA_BYTES = 5_000_000;

export function twilioMediaParts(fields: Record<string, string>, accountId: string, messageId: string) {
  const count = Math.min(Number(fields.NumMedia) || 0, 10);
  if (count <= 0) return [];

  const media = [];
  for (let index = 0; index < count; index += 1) {
    const reportedType = fields[`MediaContentType${index}`]?.split(";", 1)[0]?.toLowerCase().trim();
    const mediaType = reportedType === "image/jpg" ? "image/jpeg" : reportedType;
    const extensions = mediaType?.startsWith("image/") ? IMAGE_EXTENSIONS : AUDIO_EXTENSIONS;
    const extension = mediaType && Object.hasOwn(extensions, mediaType) ? extensions[mediaType] : undefined;
    const value = fields[`MediaUrl${index}`];
    if (!mediaType || !extension || !value) continue;

    const url = URL.parse(value);
    const prefix = `/2010-04-01/Accounts/${accountId}/Messages/${messageId}/Media/`;
    if (!url || url.origin !== "https://api.twilio.com" || !url.pathname.startsWith(prefix)
      || !/^ME[0-9a-f]{32}$/i.test(url.pathname.slice(prefix.length)) || url.username || url.password) continue;

    const key = createHash("sha256").update(url.pathname).digest("hex").slice(0, 32);
    const id = `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
    const name = mediaType.startsWith("image/") ? "photo" : "voice-note";
    media.push({ id, filename: `${name}-${id}.${extension}`, mediaType, url });
  }
  return media;
}

async function readMedia(response: Response) {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_MEDIA_BYTES) {
    throw new Error("Twilio attachment is unavailable.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_MEDIA_BYTES) throw new Error("Twilio attachment is too large.");
      chunks.push(value);
    }
  }
  finally {
    await reader.cancel().catch(() => {});
  }
  if (!size) throw new Error("Twilio attachment is empty.");
  return Buffer.concat(chunks, size);
}

export async function storeTwilioMedia(userId: string, accountId: string, token: string, media: ReturnType<typeof twilioMediaParts>) {
  const auth = Buffer.from(`${accountId}:${token}`).toString("base64");
  const results = await Promise.allSettled(media.map(async ({ url, ...part }): Promise<StoredChatFile> => {
    const file = await getChatMedia(userId, part.id);
    if (file) return { id: part.id, ...file };

    // Start with the signed Twilio account URL. Fetch strips Basic auth on
    // cross-origin redirects to a signed media URL.
    const response = await fetch(url, {
      headers: { authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(6_000),
    });
    return { ...part, bytes: await readMedia(response) };
  }));
  const files = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  await saveChatMedia(userId, files);

  const parts: MessageFilePart[] = files.map(({ id, filename, mediaType }) => ({
    type: "file", filename, mediaType, data: chatMediaReference(id),
  }));
  return { parts, failed: results.length - files.length };
}
