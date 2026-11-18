import type { AuthFn } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { ForbiddenError, vercelOidc } from "eve/channels/auth";
import { auth } from "../../auth";
import { getOnboardingProfile } from "../../server/utils/onboarding";

function appSession(): AuthFn<Request> {
  return async (request) => {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return null;
    }

    if (!(await getOnboardingProfile(session.user.id))?.complete) {
      throw new ForbiddenError({ message: "Complete your profile to open Eve." });
    }

    return {
      attributes: {
        email: session.user.email,
        name: session.user.name,
      },
      authenticator: "app",
      issuer: "app",
      principalId: session.user.id,
      principalType: "user",
    };
  };
}

export default eveChannel({
  auth: [
    appSession(),
    vercelOidc(),
  ],
});
