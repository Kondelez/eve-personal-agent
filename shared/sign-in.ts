export const PHONE_ACCOUNT_EMAIL_DOMAIN = "phone.eve.invalid";

export function isPhoneAccountEmail(email: string) {
  return email.toLowerCase().endsWith(`@${PHONE_ACCOUNT_EMAIL_DOMAIN}`);
}

export function safeSignInDestination(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  const origin = "https://eve.invalid";
  try {
    const url = new URL(value, origin);
    return url.origin === origin && !url.pathname.startsWith("//") && url.pathname.replace(/\/+$/, "") !== "/login"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/";
  }
  catch {
    return "/";
  }
}
