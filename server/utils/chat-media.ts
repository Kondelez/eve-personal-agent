import { and, eq } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";

export interface StoredChatFile {
  id: string;
  filename: string;
  mediaType: string;
  bytes: Buffer;
}

export async function saveChatMedia(userId: string, files: StoredChatFile[]) {
  if (!files.length) return;

  await db.insert(schema.chatMedia).values(files.map(file => ({ ...file, userId })))
    .onConflictDoNothing({ target: [schema.chatMedia.userId, schema.chatMedia.id] });
}

export async function getChatMedia(userId: string, id: string) {
  const [file] = await db.select({
    filename: schema.chatMedia.filename,
    mediaType: schema.chatMedia.mediaType,
    bytes: schema.chatMedia.bytes,
  }).from(schema.chatMedia)
    .where(and(eq(schema.chatMedia.userId, userId), eq(schema.chatMedia.id, id)));
  return file;
}
