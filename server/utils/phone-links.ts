import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import type { PhoneLinkRecord } from "#shared/types/phone-link";

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizePhoneNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/\D/g, "")}`;
  if (!E164_PATTERN.test(normalized)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Phone number must be in E.164 format (e.g. +33612345678)",
    });
  }

  return normalized;
}

function rowToRecord(row: typeof schema.phoneLinks.$inferSelect): PhoneLinkRecord {
  return {
    appUserId: row.appUserId,
    phoneNumber: row.phoneNumber,
    linkedAt: row.linkedAt,
    verifiedAt: row.verifiedAt,
    smsConsentAt: row.smsConsentAt,
  };
}

export async function getPhoneLinkForAppUser(appUserId: string) {
  const [row] = await db.select()
    .from(schema.phoneLinks)
    .where(eq(schema.phoneLinks.appUserId, appUserId))
    .limit(1);

  return row ? rowToRecord(row) : undefined;
}

export async function getPhoneLinkByPhoneNumber(phoneNumber: string) {
  const normalized = normalizePhoneNumber(phoneNumber);

  const [row] = await db.select()
    .from(schema.phoneLinks)
    .where(eq(schema.phoneLinks.phoneNumber, normalized))
    .limit(1);

  return row ? rowToRecord(row) : undefined;
}

export async function getSmsLinkByPhoneNumber(phoneNumber: string) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const [record] = await db.select({ link: schema.phoneLinks })
    .from(schema.phoneLinks)
    .innerJoin(schema.user, eq(schema.user.id, schema.phoneLinks.appUserId))
    .where(and(
      eq(schema.phoneLinks.phoneNumber, normalized),
      isNotNull(schema.phoneLinks.verifiedAt),
      isNotNull(schema.phoneLinks.smsConsentAt),
    ))
    .limit(1);

  return record ? rowToRecord(record.link) : undefined;
}

export async function upsertPhoneLinkForAppUser(
  appUserId: string,
  phoneNumber: string,
  verification?: { date: string; smsConsent: boolean },
  writer: Pick<typeof db, "insert"> = db,
) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const timestamps = {
    phoneNumber: normalized,
    linkedAt: new Date().toISOString(),
    verifiedAt: verification?.date ?? null,
    smsConsentAt: verification?.smsConsent ? verification.date : null,
  };
  await writer.insert(schema.phoneLinks).values({ appUserId, ...timestamps }).onConflictDoUpdate({
    target: schema.phoneLinks.appUserId,
    set: timestamps,
    // Routine profile saves include the unchanged number. Keep its verification.
    setWhere: verification ? undefined : ne(schema.phoneLinks.phoneNumber, normalized),
  });
}

export async function disableSmsForAppUser(appUserId: string) {
  await db.update(schema.phoneLinks)
    .set({ smsConsentAt: null })
    .where(eq(schema.phoneLinks.appUserId, appUserId));
}

export async function deletePhoneLinkForAppUser(appUserId: string, writer: Pick<typeof db, "delete"> = db) {
  const [deleted] = await writer.delete(schema.phoneLinks)
    .where(eq(schema.phoneLinks.appUserId, appUserId))
    .returning({ appUserId: schema.phoneLinks.appUserId });
  return Boolean(deleted);
}
