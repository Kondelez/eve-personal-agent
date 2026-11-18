export const SIGN_UP_PLACEHOLDER_NAME = "Eve user";
export const COMPLETE_PROFILE_PATH = "/complete-profile";
export const PHONE_ACCOUNT_EMAIL_DOMAIN = "phone.eve.invalid";

export function isPhoneAccountEmail(email: string) {
  return email.toLowerCase().endsWith(`@${PHONE_ACCOUNT_EMAIL_DOMAIN}`);
}

export function isProfileName(value: string) {
  const name = value.trim();
  return name.length > 0 && name.length <= 100 && name.toLowerCase() !== SIGN_UP_PLACEHOLDER_NAME.toLowerCase();
}

export function safeSignInDestination(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  const origin = "https://eve.invalid";
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.pathname.startsWith("//") && !["/login", COMPLETE_PROFILE_PATH].includes(url.pathname.replace(/\/+$/, ""))
      && !url.pathname.startsWith("/api/")
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  }
  catch {
    return "/";
  }
}
