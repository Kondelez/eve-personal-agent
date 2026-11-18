import { and, eq } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import { requireChatJson } from "~~/server/utils/chat-request";
import { requireSessionUserId } from "~~/server/utils/session";

const voteSchema = z.object({
  messageId: z.string().min(1).max(512),
  vote: z.union([z.literal(1), z.literal(-1), z.null()]),
});

export default defineEventHandler(async (event) => {
  requireChatJson(event);
  const userId = await requireSessionUserId(event);
  const { messageId, vote } = await readValidatedBody(event, voteSchema.parse);

  if (vote === null) {
    await db.delete(schema.chatVotes).where(and(eq(schema.chatVotes.userId, userId), eq(schema.chatVotes.messageId, messageId)));
  }
  else {
    await db.insert(schema.chatVotes).values({ userId, messageId, vote })
      .onConflictDoUpdate({ target: [schema.chatVotes.userId, schema.chatVotes.messageId], set: { vote } });
  }

  return { vote };
});
