import { APIError } from "better-auth/api";
import { isPhoneAccountEmail } from "#shared/sign-in";
import { reserveSignInDelivery } from "./sign-in-rate-limit";

export async function sendSignInEmail(email: string, url: string, ip: string | null) {
  if (isPhoneAccountEmail(email)) {
    throw APIError.fromStatus("BAD_REQUEST", { message: "Enter your email address or sign in by mobile number." });
  }

  await reserveSignInDelivery("email", email.toLowerCase(), ip);
  await deliverAuthEmail(email, url);
}

export async function deliverAuthEmail(email: string, url: string, purpose: "sign-in" | "verify" = "sign-in") {
  const token = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EVE_AUTH_EMAIL_FROM?.trim();
  if (!token || !from) {
    throw APIError.fromStatus("SERVICE_UNAVAILABLE", { message: "Email sign-in is temporarily unavailable." });
  }

  const verify = purpose === "verify";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: verify ? "Verify your email for Eve" : "Your Eve sign-in link",
      text: `${verify ? "Open this link to verify your email on your Eve account." : "Open Eve to sign in."} This link expires in 10 minutes.\n\n${url}\n\nIf you did not request this link, you can ignore this email.`,
    }),
    signal: AbortSignal.timeout(8_000),
  }).catch(() => undefined);

  if (!response?.ok) {
    throw APIError.fromStatus("SERVICE_UNAVAILABLE", { message: "Could not send your sign-in email. Try again in a moment." });
  }
}
