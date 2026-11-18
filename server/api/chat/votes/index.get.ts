import { eq } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { requireSessionUserId } from "~~/server/utils/session";

export default defineEventHandler(async (event) => {
  const userId = await requireSessionUserId(event);
  const votes = await db.select({
    messageId: schema.chatVotes.messageId,
    vote: schema.chatVotes.vote,
  }).from(schema.chatVotes).where(eq(schema.chatVotes.userId, userId));
  return { votes };
});
