import { createHash } from "node:crypto";
import { APIError } from "better-auth/api";
import { lte, or, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";

export function signInKey(scope: string, value: string) {
  const hash = createHash("sha256").update(value).digest("hex");
  return `eve-sign-in:${scope}:${hash}`;
}

export async function reserveSignInDelivery(channel: "email" | "phone", address: string, ip: string | null) {
  const limits = [{ id: signInKey(channel, address), expiresIn: 60_000, max: 1 }];
  if (ip) limits.push({ id: signInKey("ip", ip), expiresIn: 600_000, max: 8 });
  const now = new Date();
  const table = schema.verification;

  await db.transaction(async (transaction) => {
    for (const { id, expiresIn, max } of limits) {
      const expiresAt = new Date(now.getTime() + expiresIn);
      const expired = lte(table.expiresAt, now);
      const [reserved] = await transaction.insert(table)
        .values({ id, identifier: id, value: "1", expiresAt })
        .onConflictDoUpdate({
          target: table.id,
          set: {
            value: sql<string>`case when ${expired} then '1' else (${table.value}::integer + 1)::text end`,
            expiresAt: sql<Date>`case when ${expired} then excluded.expires_at else ${table.expiresAt} end`,
          },
          setWhere: or(expired, sql`${table.value}::integer < ${max}`),
        })
        .returning({ id: table.id });
      if (!reserved) {
        throw APIError.fromStatus("TOO_MANY_REQUESTS", { message: "Wait a minute before requesting another sign-in message." });
      }
    }
  });
}
