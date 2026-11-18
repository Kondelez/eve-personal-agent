import { ForbiddenError } from "eve/channels/auth";
import { auth } from "../../auth";
import { getOnboardingProfile } from "../../server/utils/onboarding";
import { buildAppSessionAuth } from "../../shared/app-auth";

export async function authenticateAccount(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;

  if (!(await getOnboardingProfile(session.user.id))?.complete) {
    throw new ForbiddenError({ message: "Complete your profile to open Eve." });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site"
      || (origin && origin !== new URL(request.url).origin)) {
      throw new ForbiddenError({ message: "Invalid request origin." });
    }
  }

  return buildAppSessionAuth(session.user.id, {
    email: session.user.email,
    name: session.user.name,
  });
}
