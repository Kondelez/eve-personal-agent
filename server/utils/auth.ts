import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth";
import { db, schema } from "@nuxthub/db";

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
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
});
