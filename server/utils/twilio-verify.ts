export function requestTwilioVerify(serviceSid: string, path: "Verifications" | "VerificationCheck", body: Record<string, string>) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !token || !/^VA[0-9a-f]{32}$/i.test(serviceSid)) {
    throw new Error("Twilio Verify is unavailable");
  }

  return fetch(`https://verify.twilio.com/v2/Services/${serviceSid}/${path}`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${token}`).toString("base64")}` },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(8_000),
  });
}
