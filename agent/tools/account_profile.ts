import { defineTool } from "eve/tools";
import { z } from "zod";
import { CONNECT_USER_ISSUER } from "../../shared/connect";
import { patchProfileBodySchema } from "../../server/schemas/profile";
import { fetchUserProfile, saveUserProfile } from "../lib/profile-internal";

const editable = patchProfileBodySchema.omit({ phoneNumber: true });

export default defineTool({
  description: "Read the current user's account profile, including their verified email and mobile number. Update their name, bio, timezone, or language only when they explicitly request that change. Email and mobile changes require account verification.",
  inputSchema: z.discriminatedUnion("action", [
    z.object({ action: z.literal("read") }).strict(),
    z.object({ action: z.literal("update"), patch: editable.strict() }).strict(),
  ]),
  availableInSubagents: false,
  async execute(input, ctx) {
    const auth = ctx.session.auth.current;
    if (auth?.issuer !== CONNECT_USER_ISSUER || auth.principalType !== "user") {
      throw new Error("A signed-in Eve account is required.");
    }

    const profile = input.action === "read"
      ? await fetchUserProfile(auth.principalId)
      : await saveUserProfile(auth.principalId, input.patch);
    if (!profile) throw new Error("Could not load the account profile.");

    return {
      name: profile.name,
      email: profile.email,
      phoneNumber: profile.phoneVerified ? profile.phoneNumber : undefined,
      timezone: profile.timezone,
      language: profile.locale,
      bio: profile.bio,
      smsEnabled: profile.smsEnabled,
    };
  },
});
