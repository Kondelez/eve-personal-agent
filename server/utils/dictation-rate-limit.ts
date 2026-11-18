import { db, schema } from "@nuxthub/db";
import { lte } from "drizzle-orm";

export async function reserveDictationRequest(userId: string, method: "live" | "recording") {
  const id = `eve-dictation:${method}:${userId}`;
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
    throw createError({ statusCode: 429, statusMessage: "Wait a few seconds before trying dictation again" });
  }
}
