<script setup lang="ts">
import { authClient } from "~/lib/auth-client";
import { isVerificationPhoneNumber, normalizePhoneNumberInput } from "#shared/phone-codes";
import { isProfileName, safeSignInDestination } from "#shared/sign-in";

definePageMeta({ layout: false });
useSeoMeta({ title: "Complete your Eve profile" });

const route = useRoute();
const { profile } = await useRequestFetch()("/api/onboarding");
const name = ref(profile?.name ?? "");
const email = ref(profile?.email ?? "");
const phone = ref(profile?.phoneNumber ?? "");
const nameInput = useTemplateRef("nameInput");
const emailInput = useTemplateRef("emailInput");
const phoneInput = useTemplateRef("phoneInput");
const code = ref("");
const codeInput = useTemplateRef("codeInput");
const smsConsent = ref(false);
const stage = ref<"details" | "email-sent" | "phone-code">("details");
const error = ref(route.query.emailStatus === "conflict" ? "That email already belongs to another Eve account."
  : route.query.emailStatus === "invalid" ? "That link is invalid or expired. Request a new link." : "");
const loading = ref(false);
const redirectTo = computed(() => safeSignInDestination(route.query.redirect));

function editDetails() {
  stage.value = "details";
  code.value = "";
  error.value = "";
}

async function submit(resend = false) {
  if (loading.value) return;
  error.value = "";
  name.value = (nameInput.value?.inputRef?.value ?? name.value).trim();
  email.value = (emailInput.value?.inputRef?.value ?? email.value).trim().toLowerCase();
  phone.value = normalizePhoneNumberInput(phoneInput.value?.inputRef?.value ?? phone.value, "US");
  if (!isProfileName(name.value) || !smsConsent.value) {
    error.value = "Enter your name and agree to receive SMS replies to continue.";
    return;
  }

  loading.value = true;
  const details = { name: name.value, smsConsent: smsConsent.value };
  try {
    if (!profile?.emailVerified) {
      await $fetch("/api/auth/onboarding-email/send", {
        method: "POST",
        body: { ...details, email: email.value, redirect: redirectTo.value },
      });
      stage.value = "email-sent";
    }
    else if (stage.value === "phone-code" && !resend) {
      await $fetch("/api/onboarding/verify-phone", { method: "POST", body: { code: codeInput.value?.inputRef?.value ?? code.value } });
      await navigateTo(redirectTo.value);
    }
    else if (!profile.phoneVerified) {
      if (!isVerificationPhoneNumber(phone.value)) {
        error.value = "Enter a complete mobile number, with or without +1 for US numbers.";
        return;
      }
      await $fetch("/api/onboarding/phone", {
        method: "POST",
        body: { ...details, phoneNumber: phone.value },
      });
      code.value = "";
      stage.value = "phone-code";
    }
    else {
      await $fetch("/api/onboarding", { method: "POST", body: details });
      await navigateTo(redirectTo.value);
    }
  }
  catch (cause) {
    const response = (cause as { data?: { message?: string; statusMessage?: string } }).data;
    error.value = response?.statusMessage ?? response?.message ?? "Could not complete that step. Please try again.";
  }
  finally {
    loading.value = false;
  }
}

async function useDifferentAccount() {
  loading.value = true;
  try {
    const { error: signOutError } = await authClient.signOut();
    if (signOutError) throw signOutError;
    await navigateTo("/login");
  }
  catch {
    error.value = "Could not sign out. Please try again.";
  }
  finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="flex min-h-svh items-center justify-center bg-default px-6 py-12 text-default">
    <div class="w-full max-w-sm">
      <div class="mb-6 flex items-center justify-between">
        <AppLogo class="h-5 w-auto text-highlighted" />
        <UColorModeButton color="neutral" variant="ghost" />
      </div>

      <UCard>
        <template #header>
          <h1 class="text-lg font-semibold text-highlighted">
            {{ stage === "email-sent" ? "Check your email" : stage === "phone-code" ? "Verify your mobile number" : "Complete your profile" }}
          </h1>
        </template>

        <form class="space-y-4" @submit.prevent="submit()">
          <template v-if="stage === 'details'">
            <UFormField label="Name" required>
              <UInput ref="nameInput" v-model="name" name="name" autocomplete="name" class="w-full" maxlength="100" required />
            </UFormField>

            <p v-if="profile?.emailVerified" class="break-words text-sm text-toned">
              {{ profile.email }} <span class="ms-1 text-xs text-success">Verified</span>
            </p>
            <UFormField v-else label="Email" required>
              <UInput ref="emailInput" v-model="email" name="email" type="email" autocomplete="email" class="w-full" required />
            </UFormField>

            <p v-if="profile?.phoneVerified" class="text-sm text-toned">
              {{ profile.phoneNumber }} <span class="ms-1 text-xs text-success">Verified</span>
            </p>
            <UFormField v-else-if="profile?.emailVerified" label="Mobile number" required>
              <UInput ref="phoneInput" v-model="phone" name="tel" type="tel" autocomplete="tel" class="w-full" placeholder="917 555 0147" required />
            </UFormField>

            <UCheckbox
              v-model="smsConsent"
              name="smsConsent"
              required
              label="I agree to receive AI-generated SMS replies from Kondelez Eve."
              description="Required for signup. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help."
            />
            <p class="text-xs text-muted">
              <NuxtLink to="/sms#privacy" target="_blank" class="underline">Privacy policy</NuxtLink>
              <span aria-hidden="true"> · </span>
              <NuxtLink to="/sms#terms" target="_blank" class="underline">SMS terms</NuxtLink>
            </p>
            <p v-if="profile?.emailVerified && !profile.phoneVerified" class="text-xs text-muted">
              By requesting a code, you agree to receive a verification text. Message and data rates may apply.
            </p>
          </template>

          <p v-else-if="stage === 'email-sent'" class="break-words text-sm text-toned">
            Open the verification link sent to <strong>{{ email }}</strong> in this browser to finish linking it to your account.
          </p>

          <template v-else>
            <p class="text-sm text-toned">Enter the six-digit code sent to <strong>{{ phone }}</strong>.</p>
            <UFormField label="Verification code" required>
              <UInput ref="codeInput" v-model="code" class="w-full" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required />
            </UFormField>
          </template>

          <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
          <UButton type="submit" color="neutral" block :loading="loading">
            {{ stage === "email-sent" ? "Resend link" : stage === "phone-code" ? "Verify and open Eve"
              : !profile?.emailVerified ? "Send verification link" : !profile.phoneVerified ? "Send SMS code" : "Open Eve" }}
          </UButton>
          <UButton v-if="stage === 'phone-code'" type="button" color="neutral" variant="link" :disabled="loading" @click="submit(true)">
            Resend code
          </UButton>
        </form>

        <template #footer>
          <button v-if="stage === 'details'" type="button" class="text-sm text-muted hover:underline" :disabled="loading" @click="useDifferentAccount">
            Use a different account
          </button>
          <button v-else type="button" class="text-sm text-muted hover:underline" :disabled="loading" @click="editDetails">
            Edit details
          </button>
        </template>
      </UCard>
    </div>
  </main>
</template>
