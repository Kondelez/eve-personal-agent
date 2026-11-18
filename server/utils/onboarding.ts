import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { isPhoneAccountEmail, isProfileName } from "#shared/sign-in";
import type { OnboardingProfile } from "#shared/types/onboarding";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getOnboardingProfile(userId: string): Promise<OnboardingProfile | undefined> {
  const [row] = await db.select({
    name: schema.user.name,
    email: schema.user.email,
    emailVerified: schema.user.emailVerified,
    phoneNumber: schema.phoneLinks.phoneNumber,
    phoneVerifiedAt: schema.phoneLinks.verifiedAt,
    onboardingCompletedAt: schema.userProfiles.onboardingCompletedAt,
  })
    .from(schema.user)
    .leftJoin(schema.userProfiles, eq(schema.userProfiles.userId, schema.user.id))
    .leftJoin(schema.phoneLinks, eq(schema.phoneLinks.appUserId, schema.user.id))
    .where(eq(schema.user.id, userId))
    .limit(1);

  if (!row) return;
  const email = isPhoneAccountEmail(row.email) ? undefined : row.email;
  const emailVerified = Boolean(email && row.emailVerified);
  const phoneVerified = Boolean(row.phoneVerifiedAt);

  return {
    name: isProfileName(row.name) ? row.name : "",
    email,
    emailVerified,
    phoneNumber: row.phoneNumber ?? undefined,
    phoneVerified,
    complete: Boolean(row.onboardingCompletedAt && emailVerified && phoneVerified && isProfileName(row.name)),
  };
}

export async function finishOnboarding(transaction: Transaction, userId: string, name: string) {
  const [user] = await transaction.select().from(schema.user)
    .where(eq(schema.user.id, userId)).for("update");
  if (!user?.emailVerified || isPhoneAccountEmail(user.email)) return false;

  const [phone] = await transaction.select().from(schema.phoneLinks)
    .where(and(eq(schema.phoneLinks.appUserId, userId), isNotNull(schema.phoneLinks.verifiedAt)))
    .for("update");
  if (!phone) return false;

  const [profile] = await transaction.select({ completedAt: schema.userProfiles.onboardingCompletedAt })
    .from(schema.userProfiles).where(eq(schema.userProfiles.userId, userId));
  if (profile?.completedAt && isProfileName(user.name)) return true;

  const now = new Date();
  await transaction.update(schema.user).set({ name }).where(eq(schema.user.id, userId));
  if (!phone.smsConsentAt) {
    await transaction.update(schema.phoneLinks)
      .set({ smsConsentAt: now.toISOString() }).where(eq(schema.phoneLinks.appUserId, userId));
  }
  await transaction.insert(schema.userProfiles)
    .values({ userId, onboardingCompletedAt: now })
    .onConflictDoUpdate({ target: schema.userProfiles.userId, set: { onboardingCompletedAt: now } });

  return true;
}
