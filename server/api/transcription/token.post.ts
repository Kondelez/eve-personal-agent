import { gateway } from "ai";
import { db, schema } from "@nuxthub/db";
import { lte } from "drizzle-orm";
import { DICTATION_MODEL } from "#shared/chat-dictation";
import { requireChatJson } from "~~/server/utils/chat-request";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  requireChatJson(event);
  const userId = await requireSessionUserId(event);
  const id = `eve-dictation:${userId}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5_000);
  const [permit] = await db.insert(schema.verification)
    .values({ id, identifier: id, value: "1", expiresAt })
    .onConflictDoUpdate({
      target: schema.verification.id,
      set: { expiresAt },
      setWhere: lte(schema.verification.expiresAt, now),
    })
    .returning({ id: schema.verification.id });

  if (!permit) {
    throw createError({ statusCode: 429, statusMessage: "Wait a few seconds before starting dictation again" });
  }

  try {
    return await gateway.experimental_transcription.getToken({
      model: DICTATION_MODEL,
      expiresAfterSeconds: 180,
    });
  }
  catch {
    throw createError({ statusCode: 502, statusMessage: "Dictation is temporarily unavailable" });
  }
});
