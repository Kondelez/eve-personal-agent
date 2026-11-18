<script setup lang="ts">
import { authClient } from "~/lib/auth-client";
import { isVerificationPhoneNumber } from "#shared/phone-codes";

const { profile, pending, refresh, saveProfile, timezones, locales } = useProfile();

const form = reactive({
  name: "",
  phoneNumber: "",
  timezone: "UTC",
  locale: "en",
  bio: "",
});

const saving = ref(false);
const toast = useToast();
const smsConsent = ref(false);
const smsCode = ref("");
const codeSentTo = ref("");
const phoneActionPending = ref(false);
const phoneError = ref("");
const isCurrentPhone = computed(() => form.phoneNumber === profile.value?.phoneNumber);
const canSendCode = computed(() => isVerificationPhoneNumber(form.phoneNumber));

const isDirty = computed(() => {
  if (!profile.value) return false;
  return form.name !== profile.value.name
    || form.phoneNumber !== (profile.value.phoneNumber ?? "")
    || form.timezone !== profile.value.timezone
    || form.locale !== profile.value.locale
    || form.bio !== profile.value.bio;
});

watch(profile, (value) => {
  if (!value) return;
  form.name = value.name;
  form.phoneNumber = value.phoneNumber ?? "";
  form.timezone = value.timezone;
  form.locale = value.locale;
  form.bio = value.bio;
}, { immediate: true });

watch(() => form.phoneNumber, () => {
  codeSentTo.value = "";
  smsCode.value = "";
  smsConsent.value = false;
  phoneError.value = "";
});

async function submitPhoneAction(action: "send-code" | "verify" | "disable-sms") {
  if (phoneActionPending.value) return;

  phoneActionPending.value = true;
  phoneError.value = "";
  const phoneNumber = form.phoneNumber;
  try {
    await $fetch(`/api/profile/phone/${action}`, {
      method: "POST",
      body: action === "send-code" ? { phoneNumber, smsConsent: smsConsent.value }
        : action === "verify" ? { code: smsCode.value }
        : {},
    });
    if (action === "send-code") {
      codeSentTo.value = phoneNumber;
      smsCode.value = "";
    }
    else {
      const unsaved = { name: form.name, timezone: form.timezone, locale: form.locale, bio: form.bio };
      await refresh();
      Object.assign(form, unsaved);
      codeSentTo.value = "";
      smsCode.value = "";
      smsConsent.value = false;
    }
  }
  catch (error) {
    phoneError.value = (error as { data?: { statusMessage?: string } }).data?.statusMessage
      ?? "Could not complete that phone request. Please try again.";
  }
  finally {
    phoneActionPending.value = false;
  }
}

async function handleSave() {
  if (saving.value || phoneActionPending.value || !isDirty.value) return;
  if (form.phoneNumber && !isCurrentPhone.value && !canSendCode.value) {
    phoneError.value = "Enter a complete mobile number.";
    return;
  }

  saving.value = true;
  try {
    await saveProfile({
      name: form.name.trim(),
      phoneNumber: form.phoneNumber.trim() || null,
      timezone: form.timezone,
      locale: form.locale,
      bio: form.bio,
    });
    await authClient.getSession({ query: { disableCookieCache: true } });
    toast.add({ title: "Profile saved", color: "success" });
  }
  catch {
    toast.add({ title: "Could not save profile", color: "error" });
  }
  finally {
    saving.value = false;
  }
}

function resetForm() {
  if (!profile.value) return;
  form.name = profile.value.name;
  form.phoneNumber = profile.value.phoneNumber ?? "";
  form.timezone = profile.value.timezone;
  form.locale = profile.value.locale;
  form.bio = profile.value.bio;
}
</script>

<template>
  <UDashboardPanel
    id="profile"
    class="min-h-0"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <AppNavbar />
    </template>

    <template #body>
      <div class="mx-auto w-full max-w-2xl px-6 py-8">
        <header class="mb-8">
          <h1 class="mb-1 text-lg font-medium text-highlighted">
            Settings
          </h1>
          <p class="max-w-lg text-sm text-muted">
            Manage your identity and integrations.
          </p>
        </header>

        <SettingsNav class="mb-8" />

        <div
          v-if="pending"
          class="space-y-8"
        >
          <USkeleton class="h-48 rounded-lg" />
          <USkeleton class="h-32 rounded-lg" />
        </div>

        <form
          v-else
          id="profile-form"
          class="space-y-8"
          @submit.prevent="handleSave"
        >
          <SettingsSection
            title="Profile"
            description="How V identifies you across web, Slack, and iMessage."
          >
            <SettingsRow
              label="Name"
              description="Shown in the sidebar and used when V addresses you."
            >
              <UInput
                v-model="form.name"
                class="w-full max-w-md"
                placeholder="Your name"
              />
            </SettingsRow>

            <SettingsRow
              label="Email"
              description="Used for sign-in. Contact support to change it."
            >
              <p class="text-sm text-toned">
                {{ profile?.email }}
              </p>
            </SettingsRow>

            <SettingsRow
              label="Phone"
              description="Verify your mobile number to connect SMS to this account."
            >
              <div class="space-y-3">
                <ProfilePhoneInput
                  v-model="form.phoneNumber"
                  :default-country="form.locale === 'fr' ? 'FR' : 'US'"
                />
                <template v-if="isCurrentPhone && profile?.smsEnabled">
                  <p class="text-sm text-muted">Phone verified · SMS consent saved</p>
                  <UButton type="button" variant="outline" color="neutral" :loading="phoneActionPending" @click="submitPhoneAction('disable-sms')">
                    Turn off SMS replies
                  </UButton>
                </template>
                <template v-else-if="canSendCode">
                  <p v-if="isCurrentPhone && profile?.phoneVerified" class="text-sm text-muted">Phone verified</p>
                  <template v-if="codeSentTo !== form.phoneNumber">
                    <UCheckbox
                      v-model="smsConsent"
                      label="I agree to receive AI-generated SMS replies from Kondelez Eve."
                      description="Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help."
                    />
                    <p class="text-xs text-muted">
                      <NuxtLink to="/sms#privacy" class="underline">Privacy policy</NuxtLink>
                      <span aria-hidden="true"> · </span>
                      <NuxtLink to="/sms#terms" class="underline">SMS terms</NuxtLink>
                    </p>
                    <UButton type="button" variant="outline" color="neutral" :loading="phoneActionPending" @click="submitPhoneAction('send-code')">
                      Send verification text
                    </UButton>
                  </template>
                  <div v-else class="flex flex-wrap items-center gap-2">
                    <UInput v-model="smsCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="Six-digit verification code" placeholder="6-digit code" />
                    <UButton type="button" :disabled="!/^[0-9]{6}$/.test(smsCode)" :loading="phoneActionPending" @click="submitPhoneAction('verify')">
                      Verify number
                    </UButton>
                    <UButton type="button" variant="ghost" color="neutral" :disabled="phoneActionPending" @click="submitPhoneAction('send-code')">
                      Resend code
                    </UButton>
                  </div>
                </template>
                <p v-else-if="form.phoneNumber && !phoneError" class="text-sm text-muted">Enter a complete mobile number.</p>
                <p v-if="phoneError" role="alert" class="text-sm text-error">{{ phoneError }}</p>
              </div>
            </SettingsRow>

            <SettingsRow
              label="Bio"
              description="A short intro injected into every conversation."
            >
              <UTextarea
                v-model="form.bio"
                :rows="3"
                class="w-full"
                placeholder="Staff engineer at Acme. Building observability tools. Based in Paris."
                autoresize
                :maxrows="8"
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            title="Preferences"
            description="Locale and regional settings."
          >
            <SettingsRow
              inline
              label="Timezone"
              description="Used for schedules and time-aware replies."
            >
              <UInputMenu
                v-model="form.timezone"
                :items="timezones"
                value-key="value"
                label-key="label"
                description-key="description"
                :filter-fields="['label', 'value', 'description']"
                placeholder="Search timezone…"
                icon="i-lucide-globe"
                class="w-48"
                :ui="{ content: 'min-w-(--reka-combobox-trigger-width)' }"
              />
            </SettingsRow>

            <SettingsRow
              inline
              label="Language"
            >
              <UInputMenu
                v-model="form.locale"
                :items="locales"
                value-key="value"
                label-key="label"
                description-key="description"
                :filter-fields="['label', 'value', 'description']"
                placeholder="Search language…"
                icon="i-lucide-languages"
                class="w-40"
              />
            </SettingsRow>
          </SettingsSection>
        </form>
      </div>
    </template>

    <template #footer>
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-full opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="translate-y-full opacity-0"
      >
        <div
          v-if="isDirty && !pending"
          class="border-t border-default bg-elevated/95 backdrop-blur supports-[backdrop-filter]:bg-elevated/90"
        >
          <div class="mx-auto w-full max-w-2xl px-6">
            <div class="flex items-center justify-between gap-4 py-3">
              <p class="text-sm text-muted">
                You have unsaved changes
              </p>
              <div class="flex gap-2">
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :disabled="saving"
                  @click="resetForm"
                >
                  Discard
                </UButton>
                <UButton
                  color="primary"
                  size="sm"
                  form="profile-form"
                  type="submit"
                  :loading="saving"
                >
                  Save changes
                </UButton>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </template>
  </UDashboardPanel>
</template>
