import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";

export async function setDetectedTimezone(userId: string, timezone: string) {
  try {
    timezone = new Intl.DateTimeFormat("en", { timeZone: timezone }).resolvedOptions().timeZone;
  }
  catch {
    return;
  }

  // Each account adopts its first browser timezone. A manual or legacy
  // non-default timezone takes precedence over browser detection.
  await db.update(schema.userProfiles)
    .set({ timezone, timezoneConfiguredAt: new Date() })
    .where(and(
      eq(schema.userProfiles.userId, userId),
      eq(schema.userProfiles.timezone, "UTC"),
      isNull(schema.userProfiles.timezoneConfiguredAt),
    ));
}
