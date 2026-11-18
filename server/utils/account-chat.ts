import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";

export function accountChatAddress(userId: string) {
  return `account:${userId}`;
}

export async function getAccountChatSessionId(userId: string) {
  const [chat] = await db.select({ sessionId: schema.threads.sessionId }).from(schema.threads)
    .where(and(eq(schema.threads.id, accountChatAddress(userId)), eq(schema.threads.userId, userId)));
  return chat?.sessionId ?? undefined;
}

/** Update the pointer only if it still names the owner this request observed. */
export async function bindAccountChatSession(userId: string, sessionId: string, previous?: string) {
  const id = accountChatAddress(userId);
  if (previous === sessionId) return;

  await db.transaction(async (transaction) => {
    if (!previous) {
      await transaction.insert(schema.threads)
        .values({ id, userId, sessionId, title: "Eve" })
        .onConflictDoNothing();
      return;
    }

    const [updated] = await transaction.update(schema.threads)
      .set({ sessionId })
      .where(and(eq(schema.threads.id, id), eq(schema.threads.userId, userId), eq(schema.threads.sessionId, previous)))
      .returning({ id: schema.threads.id });
    if (!updated) return;

    await transaction.insert(schema.threads)
      .values({ id: `account-history:${previous}`, userId, sessionId: previous, title: "Eve history" })
      .onConflictDoNothing();
  });
}

export async function listChatHistorySources(userId: string) {
  return db.select({ id: schema.threads.id, sessionId: schema.threads.sessionId })
    .from(schema.threads)
    .where(and(
      eq(schema.threads.userId, userId),
      ne(schema.threads.id, accountChatAddress(userId)),
      isNotNull(schema.threads.sessionId),
    ))
    .orderBy(desc(sql`(${schema.threads.id} like 'account-history:%')`), desc(schema.threads.updatedAt))
    .limit(6);
}

export async function getChatPhoneBinding(userId: string) {
  const [phone] = await db.select({
    phoneNumber: schema.phoneLinks.phoneNumber,
    verifiedAt: schema.phoneLinks.verifiedAt,
  }).from(schema.phoneLinks).where(eq(schema.phoneLinks.appUserId, userId));
  return phone;
}
