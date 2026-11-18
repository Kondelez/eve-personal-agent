export const MAX_CHAT_FILES = 5;
export const MAX_CHAT_FILE_BYTES = 3_000_000;
export const CHAT_MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WEB_CHAT_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf", "text/plain", "text/markdown", "text/csv",
] as const;

const referenceOrigin = "https://eve-uploads.invalid";

export function chatMediaReference(id: string) {
  return `${referenceOrigin}/${id}`;
}

export function chatMediaId(reference: string) {
  const prefix = `${referenceOrigin}/`;
  if (!reference.startsWith(prefix)) return;
  const id = reference.slice(prefix.length);
  if (CHAT_MEDIA_ID.test(id)) return id;
}

export function chatMediaPath(id: string) {
  return `/api/chat/media/${id}`;
}
