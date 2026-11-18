import { randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, formCsrfMiddleware, getIP, getSessionFromCtx, sessionMiddleware } from "better-auth/api";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@nuxthub/db";
import { z } from "zod";
import { COMPLETE_PROFILE_PATH, safeSignInDestination } from "#shared/sign-in";
import { onboardingEmailSchema } from "../schemas/onboarding";
import { finishOnboarding, getOnboardingProfile } from "./onboarding";
import { deliverAuthEmail } from "./sign-in-email";
import { reserveSignInDelivery, signInKey } from "./sign-in-rate-limit";

const VERIFY_PATH = "/onboarding-email/verify";
const CODE_TTL_MS = 10 * 60_000;

interface EmailChallenge {
  email: string;
  name: string;
  phoneNumber?: string;
  redirect: string;
  tokenHash: string;
}

export function onboardingEmail() {
  return {
    id: "eve-onboarding-email",
    endpoints: {
      sendOnboardingEmail: createAuthEndpoint("/onboarding-email/send", {
        method: "POST",
        requireRequest: true,
        use: [formCsrfMiddleware, sessionMiddleware],
        body: onboardingEmailSchema,
      }, async (ctx) => {
        const userId = ctx.context.session.user.id;
        const profile = await getOnboardingProfile(userId);
        if (!profile || profile.emailVerified) {
          throw APIError.fromStatus("CONFLICT", { message: "This account already has a verified email." });
        }

        const { email, name, redirect } = ctx.body;
        const [existing] = await db.select({ id: schema.user.id }).from(schema.user)
          .where(eq(sql`lower(${schema.user.email})`, email)).limit(1);
        if (existing && existing.id !== userId) {
          throw APIError.fromStatus("CONFLICT", { message: "That email already belongs to another Eve account. Use a different email or sign in to that account." });
        }

        const ip = ctx.request ? getIP(ctx.request, ctx.context.options) : null;
        await reserveSignInDelivery("email", email, ip);
        const token = randomBytes(32).toString("base64url");
        const id = signInKey("onboarding-account", userId);
        const challenge: EmailChallenge = {
          email,
          name,
          phoneNumber: profile.phoneVerified ? profile.phoneNumber : undefined,
          redirect: safeSignInDestination(redirect),
          tokenHash: signInKey("onboarding-token", token),
        };
        const value = JSON.stringify(challenge);
        const expiresAt = new Date(Date.now() + CODE_TTL_MS);
        await db.insert(schema.verification)
          .values({ id, identifier: id, value, expiresAt })
          .onConflictDoUpdate({ target: schema.verification.id, set: { value, expiresAt } });

        const url = new URL(ctx.context.baseURL);
        url.pathname = `${url.pathname.replace(/\/$/, "")}${VERIFY_PATH}`;
        url.searchParams.set("token", token);
        await deliverAuthEmail(email, url.toString(), "verify");

        return ctx.json({ ok: true });
      }),

      verifyOnboardingEmail: createAuthEndpoint(VERIFY_PATH, {
        method: "GET",
        query: z.object({ token: z.string().length(43) }),
      }, async (ctx) => {
        ctx.setHeader("referrer-policy", "no-referrer");
        const session = await getSessionFromCtx(ctx);
        if (!session) throw ctx.redirect("/login?emailStatus=session-required");

        const userId = session.user.id;
        const id = signInKey("onboarding-account", userId);
        const tokenHash = signInKey("onboarding-token", ctx.query.token);
        let destination: string | undefined;
        try {
          destination = await db.transaction(async (transaction) => {
            const [entry] = await transaction.select().from(schema.verification)
              .where(and(eq(schema.verification.id, id), gt(schema.verification.expiresAt, new Date())))
              .for("update");
            if (!entry) return;
            const challenge = JSON.parse(entry.value) as EmailChallenge;
            if (challenge.tokenHash !== tokenHash) return;

            const [updated] = await transaction.update(schema.user)
              .set({ name: challenge.name, email: challenge.email, emailVerified: true })
              .where(and(eq(schema.user.id, userId), eq(schema.user.emailVerified, false)))
              .returning({ id: schema.user.id });
            if (!updated) return;

            const [link] = await transaction.select().from(schema.phoneLinks)
              .where(eq(schema.phoneLinks.appUserId, userId)).for("update");
            if (link?.verifiedAt && link.phoneNumber === challenge.phoneNumber) {
              await finishOnboarding(transaction, userId, challenge.name);
            }
            await transaction.delete(schema.verification).where(eq(schema.verification.id, id));
            return challenge.redirect;
          });
        }
        catch (error) {
          const cause = error as { cause?: { code?: string }; code?: string };
          if (cause.code !== "23505" && cause.cause?.code !== "23505") throw error;
          throw ctx.redirect(`${COMPLETE_PROFILE_PATH}?emailStatus=conflict`);
        }

        if (!destination) throw ctx.redirect(`${COMPLETE_PROFILE_PATH}?emailStatus=invalid`);
        throw ctx.redirect(`${COMPLETE_PROFILE_PATH}?redirect=${encodeURIComponent(destination)}`);
      }),
    },
  } satisfies BetterAuthPlugin;
}
