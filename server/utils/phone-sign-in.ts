import { randomUUID } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, formCsrfMiddleware, getIP } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import { PHONE_ACCOUNT_EMAIL_DOMAIN, SIGN_UP_PLACEHOLDER_NAME } from "#shared/sign-in";
import { checkPhoneVerificationSchema, startPhoneVerificationSchema } from "../schemas/phone";
import { reserveSignInDelivery, signInKey } from "./sign-in-rate-limit";
import { requestTwilioVerify } from "./twilio-verify";

const CODE_TTL_MS = 10 * 60_000;
const phoneNumberSchema = startPhoneVerificationSchema.pick({ phoneNumber: true });
const signInCodeSchema = checkPhoneVerificationSchema.extend({ attempt: z.uuid() });

async function sendToVerify(path: "Verifications" | "VerificationCheck", body: Record<string, string>) {
  const service = process.env.TWILIO_SIGN_IN_VERIFY_SERVICE_SID?.trim();
  try {
    const response = await requestTwilioVerify(service ?? "", path, body);
    return {
      status: response.status,
      details: await response.json() as { sid?: string; status?: string; to?: string },
    };
  }
  catch {
    throw APIError.fromStatus("SERVICE_UNAVAILABLE", { message: "Text sign-in is temporarily unavailable." });
  }
}

async function resolvePhoneAccount(phoneNumber: string, attemptId: string) {
  return db.transaction(async (transaction) => {
    const [attempt] = await transaction.delete(schema.verification)
      .where(and(eq(schema.verification.id, attemptId), gt(schema.verification.expiresAt, new Date())))
      .returning({ id: schema.verification.id });
    if (!attempt) throw APIError.fromStatus("BAD_REQUEST", { message: "Request a new verification code." });

    const [link] = await transaction.select().from(schema.phoneLinks)
      .where(eq(schema.phoneLinks.phoneNumber, phoneNumber)).for("update");
    if (link) {
      if (!link.verifiedAt) {
        throw APIError.fromStatus("CONFLICT", { message: "Sign in with email, then verify this number in Profile to link it to that account." });
      }
      const [existingUser] = await transaction.select().from(schema.user).where(eq(schema.user.id, link.appUserId));
      if (!existingUser) throw APIError.fromStatus("CONFLICT", { message: "This number is already linked. Contact support." });
      return existingUser;
    }

    const userId = randomUUID();
    const [newUser] = await transaction.insert(schema.user).values({
      id: userId,
      name: SIGN_UP_PLACEHOLDER_NAME,
      email: `${userId}@${PHONE_ACCOUNT_EMAIL_DOMAIN}`,
    }).returning();
    if (!newUser) throw APIError.fromStatus("INTERNAL_SERVER_ERROR", { message: "Could not create your account." });
    const [linked] = await transaction.insert(schema.phoneLinks).values({
      appUserId: userId,
      phoneNumber,
      verifiedAt: new Date().toISOString(),
    }).onConflictDoNothing().returning({ appUserId: schema.phoneLinks.appUserId });
    if (!linked) throw APIError.fromStatus("CONFLICT", { message: "Request a new code to sign in with this number." });
    return newUser;
  });
}

const post = { method: "POST" as const, requireRequest: true, use: [formCsrfMiddleware] };

export function phoneSignIn() {
  return {
    id: "eve-phone-sign-in",
    endpoints: {
      sendPhoneSignInCode: createAuthEndpoint("/phone-login/send-code", { ...post, body: phoneNumberSchema }, async (ctx) => {
        const { phoneNumber } = ctx.body;
        const ip = ctx.request ? getIP(ctx.request, ctx.context.options) : null;
        await reserveSignInDelivery("phone", phoneNumber, ip);
        const result = await sendToVerify("Verifications", { To: phoneNumber, Channel: "sms" });
        if (result.status >= 400 || result.details.status !== "pending" || !result.details.sid) {
          throw APIError.fromStatus("BAD_REQUEST", { message: "Could not send a text to that number. Check the number and try again." });
        }

        const attempt = randomUUID();
        const id = signInKey("challenge", attempt);
        await db.insert(schema.verification).values({
          id,
          identifier: id,
          value: JSON.stringify({ phoneNumber, sid: result.details.sid }),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        });
        return ctx.json({ attempt });
      }),

      confirmPhoneSignInCode: createAuthEndpoint("/phone-login/verify", { ...post, body: signInCodeSchema }, async (ctx) => {
        const id = signInKey("challenge", ctx.body.attempt);
        const [challenge] = await db.select().from(schema.verification)
          .where(and(eq(schema.verification.id, id), gt(schema.verification.expiresAt, new Date())));
        if (!challenge) throw APIError.fromStatus("BAD_REQUEST", { message: "Request a new verification code." });

        const { phoneNumber, sid } = JSON.parse(challenge.value) as { phoneNumber: string; sid: string };
        const result = await sendToVerify("VerificationCheck", { VerificationSid: sid, Code: ctx.body.code });
        if (result.status >= 500) {
          throw APIError.fromStatus("SERVICE_UNAVAILABLE", { message: "Text sign-in is temporarily unavailable." });
        }
        if (result.details.status !== "approved" || result.details.to !== phoneNumber) {
          throw APIError.fromStatus("BAD_REQUEST", { message: "That code is invalid or expired." });
        }

        const user = await resolvePhoneAccount(phoneNumber, id);
        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) throw APIError.fromStatus("INTERNAL_SERVER_ERROR", { message: "Could not sign you in." });
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ ok: true });
      }),
    },
    rateLimit: [{ pathMatcher: path => path.startsWith("/phone-login/"), window: 60, max: 12 }],
  } satisfies BetterAuthPlugin;
}
