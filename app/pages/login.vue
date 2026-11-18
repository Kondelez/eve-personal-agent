<script setup lang="ts">
import { authClient } from "~/lib/auth-client";
import { isVerificationPhoneNumber, normalizePhoneNumberInput } from "#shared/phone-codes";
import { safeSignInDestination, SIGN_UP_PLACEHOLDER_NAME } from "#shared/sign-in";

definePageMeta({ layout: false });
useSeoMeta({ title: "Sign in to Eve" });

const route = useRoute();
const stage = ref<"identify" | "email-sent" | "phone-code">("identify");
const identifier = ref("");
const identifierInput = useTemplateRef("identifierInput");
const destination = ref("");
const attempt = ref("");
const code = ref("");
const codeInput = useTemplateRef("codeInput");
const error = ref(route.query.emailStatus === "session-required"
  ? "Sign in with your mobile number, then reopen the verification link."
  : "");
const loading = ref(false);
const showLinkError = ref(Boolean(route.query.error));
const redirectTo = computed(() => safeSignInDestination(route.query.redirect));

function reset() {
  stage.value = "identify";
  code.value = "";
  attempt.value = "";
  error.value = "";
  showLinkError.value = false;
}

async function sendEmailLink(email: string) {
  const result = await authClient.signIn.magicLink({
    email,
    name: SIGN_UP_PLACEHOLDER_NAME,
    callbackURL: redirectTo.value,
    errorCallbackURL: "/login",
  });
  if (result.error) {
    error.value = result.error.message ?? "Could not send the sign-in link.";
    return;
  }
  destination.value = email;
  stage.value = "email-sent";
}

async function sendPhoneCode(phoneNumber: string) {
  const response = await $fetch<{ attempt: string }>("/api/auth/phone-login/send-code", {
    method: "POST",
    body: { phoneNumber },
  });
  destination.value = phoneNumber;
  attempt.value = response.attempt;
  code.value = "";
  stage.value = "phone-code";
}

async function handleSubmit(resend = false) {
  if (loading.value) return;
  // Autofill can update the native field without firing a Vue model update.
  const value = (identifierInput.value?.inputRef?.value ?? identifier.value).trim();
  identifier.value = value;
  error.value = "";
  showLinkError.value = false;
  loading.value = true;
  try {
    if (stage.value === "email-sent") {
      await sendEmailLink(destination.value);
    }
    else if (stage.value === "phone-code" && resend) {
      await sendPhoneCode(destination.value);
    }
    else if (stage.value === "phone-code") {
      await $fetch("/api/auth/phone-login/verify", {
        method: "POST",
        body: { attempt: attempt.value, code: codeInput.value?.inputRef?.value ?? code.value },
      });
      await navigateTo(redirectTo.value);
    }
    else if (value.includes("@")) {
      await sendEmailLink(value.toLowerCase());
    }
    else {
      const phoneNumber = normalizePhoneNumberInput(value, "US");
      if (!isVerificationPhoneNumber(phoneNumber)) {
        const nationalDigits = /^\+1(\d+)$/.exec(phoneNumber)?.[1];
        error.value = nationalDigits && nationalDigits.length !== 10
          ? `This number has ${nationalDigits.length} digits after +1. Enter 10 digits, with or without +1.`
          : "Enter an email address or a complete mobile number.";
        return;
      }
      await sendPhoneCode(phoneNumber);
    }
  }
  catch (cause) {
    const response = (cause as { data?: { message?: string } }).data;
    error.value = response?.message ?? "Could not complete sign-in. Please try again.";
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
            {{ stage === "email-sent" ? "Check your email" : stage === "phone-code" ? "Enter your code" : "Continue to Eve" }}
          </h1>
        </template>

        <form class="space-y-4" @submit.prevent="handleSubmit()">
          <UFormField
            v-if="stage === 'identify'"
            label="Email or mobile number"
          >
            <UInput
              ref="identifierInput"
              v-model="identifier"
              class="w-full"
              name="identifier"
              autocomplete="username"
              autocapitalize="none"
              autocorrect="off"
              :spellcheck="false"
              required
              placeholder="you@example.com or 917 555 0147"
            />
          </UFormField>

          <p v-if="stage === 'email-sent'" class="break-words text-sm text-toned">
            We sent a one-time sign-in link to <strong>{{ destination }}</strong>.
          </p>

          <template v-if="stage === 'phone-code'">
            <p class="text-sm text-toned">
              We sent a six-digit code to <strong>{{ destination }}</strong>.
            </p>
            <UFormField label="Verification code">
              <UInput
                ref="codeInput"
                v-model="code"
                class="w-full"
                inputmode="numeric"
                autocomplete="one-time-code"
                pattern="[0-9]{6}"
                maxlength="6"
                required
              />
            </UFormField>
          </template>

          <p v-if="error || showLinkError" role="alert" class="text-sm text-error">
            {{ error || "That link is invalid or expired. Request a new one." }}
          </p>

          <UButton type="submit" block color="neutral" :loading="loading">
            {{ stage === "email-sent" ? "Send another link" : stage === "phone-code" ? "Verify and sign in" : "Continue" }}
          </UButton>
          <button
            v-if="stage === 'phone-code'"
            type="button"
            class="text-sm text-muted hover:underline"
            :disabled="loading"
            @click="handleSubmit(true)"
          >
            Resend code
          </button>
        </form>

        <template #footer>
          <p v-if="stage === 'identify'" class="mb-3 text-xs text-muted">
            By continuing with a mobile number, you agree to receive a verification text. Message and data rates may apply.
          </p>
          <button
            v-else
            type="button"
            class="text-sm text-muted hover:underline"
            :disabled="loading"
            @click="reset"
          >
            Use email or mobile number
          </button>
        </template>
      </UCard>
    </div>
  </main>
</template>
