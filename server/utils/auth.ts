import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { getIP } from "better-auth/api";
import { magicLink } from "better-auth/plugins/magic-link";
import { db, schema } from "@nuxthub/db";
import { phoneSignIn } from "./phone-sign-in";
import { sendSignInEmail } from "./sign-in-email";

const productionUrl = process.env.BETTER_AUTH_URL?.trim();
const customUrl = process.env.BETTER_AUTH_CUSTOM_URL?.trim();

const baseURL = customUrl
  ? {
      allowedHosts: [
        new URL(customUrl).host,
        ...(productionUrl ? [new URL(productionUrl).host] : []),
        process.env.VERCEL_PROJECT_PRODUCTION_URL,
        process.env.VERCEL_URL,
      ].filter((host): host is string => !!host),
      fallback: customUrl,
      protocol: "https" as const,
    }
  : productionUrl;

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: productionUrl ? [productionUrl] : undefined,
  advanced: process.env.VERCEL ? { ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for"] } } : undefined,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  plugins: [
    magicLink({
      expiresIn: 600,
      storeToken: "hashed",
      async sendMagicLink({ email, url }, ctx) {
        const ip = ctx?.request ? getIP(ctx.request, ctx.context.options) : null;
        await sendSignInEmail(email, url, ip);
      },
    }),
    phoneSignIn(),
  ],
});
