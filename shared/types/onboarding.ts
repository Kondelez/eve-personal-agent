export interface OnboardingProfile {
  name: string;
  email?: string;
  emailVerified: boolean;
  phoneNumber?: string;
  phoneVerified: boolean;
  complete: boolean;
}
