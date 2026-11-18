import { eq } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import type { UserProfile, UserProfilePatch, UserProfileWithUser } from "#shared/types/profile";
import { getPhoneLinkForAppUser } from "./phone-links";

function rowToProfile(row: typeof schema.userProfiles.$inferSelect): UserProfile {
  return {
    userId: row.userId,
    timezone: row.timezone,
    locale: row.locale,
    bio: row.bio,
    updatedAt: row.updatedAt.getTime(),
  };
}

export async function getProfileForUser(userId: string): Promise<UserProfile | undefined> {
  const [row] = await db.select()
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);

  return row ? rowToProfile(row) : undefined;
}

export async function getOrCreateProfileForUser(userId: string): Promise<UserProfile> {
  const existing = await getProfileForUser(userId);
  if (existing) {
    return existing;
  }

  await db.insert(schema.userProfiles).values({ userId }).onConflictDoNothing();

  const created = await getProfileForUser(userId);
  if (!created) {
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to create profile",
    });
  }

  return created;
}

export async function getProfileWithUser(userId: string): Promise<UserProfileWithUser | undefined> {
  const [row] = await db.select({
    profile: schema.userProfiles,
    user: schema.user,
  })
    .from(schema.user)
    .leftJoin(schema.userProfiles, eq(schema.userProfiles.userId, schema.user.id))
    .where(eq(schema.user.id, userId))
    .limit(1);

  if (!row?.user) {
    return undefined;
  }

  const profile = row.profile
    ? rowToProfile(row.profile)
    : await getOrCreateProfileForUser(userId);

  const phoneLink = await getPhoneLinkForAppUser(userId);

  return {
    ...profile,
    name: row.user.name,
    email: row.user.email,
    phoneNumber: phoneLink?.phoneNumber,
    phoneVerified: Boolean(phoneLink?.verifiedAt),
    smsEnabled: Boolean(phoneLink?.verifiedAt && phoneLink.smsConsentAt),
  };
}

export async function updateProfileForUser(userId: string, patch: UserProfilePatch) {
  await getOrCreateProfileForUser(userId);

  await db.transaction(async (transaction) => {
    if (patch.phoneNumber !== undefined) {
      const [link] = await transaction.select({ phone: schema.phoneLinks.phoneNumber }).from(schema.phoneLinks)
        .where(eq(schema.phoneLinks.appUserId, userId));
      if ((patch.phoneNumber?.trim() ?? "") !== link?.phone) {
        throw createError({ statusCode: 409, statusMessage: "Verify a new number to change your mobile number." });
      }
    }

    if (patch.name !== undefined) {
      await transaction.update(schema.user)
        .set({ name: patch.name.trim() })
        .where(eq(schema.user.id, userId));
    }

    if (patch.timezone !== undefined || patch.locale !== undefined || patch.bio !== undefined) {
      await transaction.update(schema.userProfiles)
        .set({
          timezone: patch.timezone,
          timezoneConfiguredAt: patch.timezone === undefined ? undefined : new Date(),
          locale: patch.locale,
          bio: patch.bio,
        })
        .where(eq(schema.userProfiles.userId, userId));
    }
  });

  return getProfileWithUser(userId);
}
