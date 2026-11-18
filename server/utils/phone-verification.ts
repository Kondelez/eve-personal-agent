import { and, eq, gt, lt } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import type { H3Event } from "h3";
import { finishOnboarding } from "./onboarding";
import { upsertPhoneLinkForAppUser } from "./phone-links";
import { requestTwilioVerify } from "./twilio-verify";

const RESEND_DELAY_MS = 60_000;
const VERIFICATION_TTL_MS = 10 * 60_000;

type PhoneChallenge = {
  phoneNumber: string;
  smsConsent: boolean;
  verificationSid?: string;
  onboardingName?: string;
};

export function requirePhoneVerificationRequest(event: H3Event) {
  // A cross-origin form cannot post JSON to this session-authenticated API.
  if (getRequestHeader(event, "content-type")?.split(";", 1)[0] !== "application/json") {
    throw createError({ statusCode: 415, statusMessage: "Expected JSON" });
  }
}

function requestProfileVerification(path: "Verifications" | "VerificationCheck", body: Record<string, string>) {
  const service = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  if (!service) {
    throw createError({ statusCode: 503, statusMessage: "Phone verification is unavailable" });
  }
  return requestTwilioVerify(service, path, body);
}

export async function startPhoneVerification(userId: string, challenge: Omit<PhoneChallenge, "verificationSid">) {
  const id = `eve-sms:${userId}`;
  const now = new Date();
  const value = JSON.stringify(challenge);
  const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);
  const [reserved] = await db.insert(schema.verification)
    .values({ id, identifier: id, value, expiresAt, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.verification.id,
      set: { value, expiresAt, createdAt: now, updatedAt: now },
      setWhere: lt(schema.verification.createdAt, new Date(now.getTime() - RESEND_DELAY_MS)),
    })
    .returning({ id: schema.verification.id });

  if (!reserved) {
    throw createError({ statusCode: 429, statusMessage: "Wait a minute before requesting another code" });
  }

  const response = await requestProfileVerification("Verifications", { To: challenge.phoneNumber, Channel: "sms" });
  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: "Could not send a verification code" });
  }
  const result = await response.json() as { sid?: string; status?: string };
  if (!result.sid || result.status !== "pending") {
    throw createError({ statusCode: 502, statusMessage: "Could not start phone verification" });
  }

  await db.update(schema.verification)
    .set({ value: JSON.stringify({ ...challenge, verificationSid: result.sid }) })
    .where(and(eq(schema.verification.id, id), eq(schema.verification.createdAt, now)));
}

export async function checkPhoneVerification(userId: string, code: string, onboarding = false) {
  const id = `eve-sms:${userId}`;
  const [entry] = await db.select().from(schema.verification)
    .where(and(eq(schema.verification.id, id), gt(schema.verification.expiresAt, new Date())));
  const challenge = entry ? JSON.parse(entry.value) as PhoneChallenge : undefined;
  if (!entry || !challenge?.verificationSid || onboarding !== Boolean(challenge.onboardingName)) {
    throw createError({ statusCode: 400, statusMessage: "Request a new verification code" });
  }

  const response = await requestProfileVerification("VerificationCheck", { VerificationSid: challenge.verificationSid, Code: code });
  if (response.status >= 500) {
    throw createError({ statusCode: 502, statusMessage: "Phone verification is temporarily unavailable" });
  }
  const result = response.ok ? await response.json() as { status?: string; to?: string } : undefined;
  if (result?.status !== "approved" || result.to !== challenge.phoneNumber) {
    throw createError({ statusCode: 400, statusMessage: "The verification code is invalid or expired" });
  }

  try {
    await db.transaction(async (transaction) => {
      const [consumed] = await transaction.update(schema.verification).set({ value: "{}" })
        .where(and(
          eq(schema.verification.id, id),
          eq(schema.verification.createdAt, entry.createdAt),
          eq(schema.verification.value, entry.value),
        ))
        .returning({ id: schema.verification.id });
      if (!consumed) {
        throw createError({ statusCode: 400, statusMessage: "Request a new verification code" });
      }

      // Lock the account before changing its phone and completing the profile.
      if (challenge.onboardingName) {
        await transaction.select({ id: schema.user.id }).from(schema.user)
          .where(eq(schema.user.id, userId)).for("update");
        const [link] = await transaction.select().from(schema.phoneLinks)
          .where(eq(schema.phoneLinks.appUserId, userId)).for("update");
        if (link?.verifiedAt) {
          throw createError({ statusCode: 409, statusMessage: "This account already has a verified mobile number." });
        }
      }
      await upsertPhoneLinkForAppUser(userId, challenge.phoneNumber, {
        date: new Date().toISOString(),
        smsConsent: challenge.smsConsent,
      }, transaction);
      if (challenge.onboardingName && !await finishOnboarding(transaction, userId, challenge.onboardingName)) {
        throw createError({ statusCode: 409, statusMessage: "Verify your email first." });
      }
    });
  }
  catch (error) {
    const cause = error as { cause?: { code?: string }; code?: string };
    if (cause.code === "23505" || cause.cause?.code === "23505") {
      throw createError({ statusCode: 409, statusMessage: "This phone number is already linked to another account" });
    }
    throw error;
  }
}
