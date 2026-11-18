import type { MessageContent } from "eve/client";

import { chatMediaReference } from "#shared/chat-media";

export { MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES } from "#shared/chat-media";
export const MAX_CHAT_TEXT_LENGTH = 12_000;

export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif";
export const FILE_ACCEPT = `${PHOTO_ACCEPT},application/pdf,text/plain,text/markdown,text/csv,.pdf,.txt,.md,.csv`;

const mediaTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};
const supportedTypes = new Set(Object.values(mediaTypes));

export interface ChatAttachment {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  data: string;
}

export interface ChatDraft {
  text: string;
  attachments: readonly ChatAttachment[];
}

export function draftContent(draft: ChatDraft): MessageContent {
  if (!draft.attachments.length) return draft.text;
  return [
    ...(draft.text ? [{ type: "text" as const, text: draft.text }] : []),
    ...draft.attachments.map(({ id, filename, mediaType }) => ({
      type: "file" as const,
      filename,
      mediaType,
      data: chatMediaReference(id),
    })),
  ];
}


export async function storeDraftFiles(attachments: readonly ChatAttachment[]) {
  if (!attachments.length) return;
  await $fetch("/api/chat/media", {
    method: "POST",
    body: {
      files: attachments.map(({ id, filename, mediaType, data }) => ({
        id, filename, mediaType, data: data.slice(data.indexOf(",") + 1),
      })),
    },
  });
}

function asDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onabort = reader.onerror;
    reader.readAsDataURL(file);
  });
}

async function shrinkPhoto(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const photo = new Image();
    photo.src = url;
    await photo.decode();
    const ratio = Math.min(1, 1800 / Math.max(photo.naturalWidth, photo.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(photo.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(photo.naturalHeight * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not resize this photo.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
    const resized = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!resized) throw new Error("Could not resize this photo.");
    return resized;
  }
  catch {
    throw new Error("Could not open this photo. Try a JPEG or PNG.");
  }
  finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareChatFile(file: File, remainingBytes: number): Promise<ChatAttachment> {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  let mediaType = mediaTypes[extension] ?? file.type;
  if (!supportedTypes.has(mediaType)) {
    throw new Error("Choose a photo, PDF, text file, or CSV.");
  }
  if (!file.size) throw new Error("This file is empty.");
  if (remainingBytes <= 0) throw new Error("Attachments can total up to 3 MB per message.");

  let blob: Blob = file.slice(0, file.size, mediaType);
  let filename = file.name;
  const needsConversion = mediaType === "image/heic" || mediaType === "image/heif";
  if (needsConversion || (mediaType.startsWith("image/") && mediaType !== "image/gif" && blob.size > remainingBytes)) {
    if (blob.size > 25_000_000) throw new Error("This photo is too large to resize. Try a smaller photo.");
    blob = await shrinkPhoto(blob);
    mediaType = blob.type;
    filename = `${filename.replace(/\.[^.]+$/, "")}.jpg`;
  }
  if (blob.size > remainingBytes) {
    throw new Error("Attachments can total up to 3 MB per message.");
  }

  return {
    id: crypto.randomUUID(),
    filename: filename.slice(-180),
    mediaType,
    size: blob.size,
    data: await asDataUrl(blob),
  };
}
