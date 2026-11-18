import type { H3Event } from "h3";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "~~/auth";
import { getNodeRequest } from "~~/server/utils/h3-node";
import { getOnboardingProfile } from "./onboarding";

export async function getSignedInUserId(event: H3Event) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(getNodeRequest(event).headers),
    returnHeaders: true,
  });

  // Forward Better Auth's refreshed cookie so an active web session stays signed in.
  for (const cookie of session.headers.getSetCookie()) appendResponseHeader(event, "set-cookie", cookie);

  return session.response?.user?.id;
}

export async function requireSignedInUserId(event: H3Event): Promise<string> {
  const userId = await getSignedInUserId(event);
  if (!userId) throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  return userId;
}

export async function requireSessionUserId(event: H3Event): Promise<string> {
  const userId = await requireSignedInUserId(event);
  if (!(await getOnboardingProfile(userId))?.complete) {
    throw createError({ statusCode: 403, statusMessage: "Complete your profile to continue." });
  }
  return userId;
}
