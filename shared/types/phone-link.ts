export interface PhoneLinkRecord {
  appUserId: string;
  phoneNumber: string;
  linkedAt: string;
  verifiedAt: string | null;
  smsConsentAt: string | null;
}
