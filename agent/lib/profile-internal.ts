import type { UserProfilePatch, UserProfileWithUser } from "../../shared/types/profile.js";
import { appOrigin, internalHeaders } from "./internal-api.js";

export async function fetchUserProfile(userId: string): Promise<UserProfileWithUser | undefined> {
  try {
    const response = await fetch(
      `${appOrigin()}/api/internal/profile?userId=${encodeURIComponent(userId)}`,
      { headers: internalHeaders() },
    );

    if (!response.ok) {
      return undefined;
    }

    const { profile } = await response.json() as { profile: UserProfileWithUser | null };
    return profile ?? undefined;
  }
  catch {
    return undefined;
  }
}

export async function saveUserProfile(userId: string, patch: Omit<UserProfilePatch, "phoneNumber">): Promise<UserProfileWithUser | undefined> {
  const response = await fetch(`${appOrigin()}/api/internal/profile`, {
    method: "PATCH",
    headers: internalHeaders(),
    body: JSON.stringify({ userId, patch }),
  });

  if (!response.ok) {
    throw new Error(response.status === 400 ? "The requested profile values are invalid." : "Could not save the account profile.");
  }
  const { profile } = await response.json() as { profile: UserProfileWithUser | null };
  return profile ?? undefined;
}
