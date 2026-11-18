<script setup lang="ts">
import { authClient } from "~/lib/auth-client";
import { isVerificationPhoneNumber } from "#shared/phone-codes";
import type { UserProfilePatch } from "#shared/types/profile";

const { profile, pending, refresh, saveProfile, timezones, locales } = useProfile();

const form = reactive({
  name: "",
  phoneNumber: "",
  timezone: "UTC",
  locale: "en",
  bio: "",
});

const saving = ref(false);
const saved = ref(false);
const saveFailed = ref(false);
let loadedUserId: string | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let inFlightSave: Promise<void> | undefined;
const smsConsent = ref(false);
const smsCode = ref("");
const codeSentTo = ref("");
const phoneActionPending = ref(false);
const phoneError = ref("");
const isCurrentPhone = computed(() => form.phoneNumber === profile.value?.phoneNumber);
const canSendCode = computed(() => isVerificationPhoneNumber(form.phoneNumber));

const pendingEdits = computed<UserProfilePatch>(() => {
  const current = profile.value;
  if (!current || current.userId !== loadedUserId) return {};

  const patch: UserProfilePatch = {};
  const name = form.name.trim();
  const bio = form.bio.trim();
  if (name && name !== current.name) patch.name = name;
  if (bio !== current.bio) patch.bio = bio;
  if (form.timezone !== current.timezone) patch.timezone = form.timezone;
  if (form.locale !== current.locale) patch.locale = form.locale;
  return patch;
});

watch(profile, (value) => {
  if (!value || value.userId === loadedUserId) return;
  loadedUserId = value.userId;
  form.name = value.name;
  form.phoneNumber = value.phoneNumber ?? "";
  form.timezone = value.timezone;
  form.locale = value.locale;
  form.bio = value.bio;
}, { immediate: true });

function scheduleSave() {
  clearTimeout(saveTimer);
  if (inFlightSave || phoneActionPending.value || !Object.keys(pendingEdits.value).length) return;
  saveTimer = setTimeout(saveChanges, 450);
}

watch([() => form.name, () => form.bio, () => form.timezone, () => form.locale], () => {
  saveFailed.value = false;
  scheduleSave();
});

async function persistEdits(patch: UserProfilePatch) {
  saving.value = true;
  saveFailed.value = false;
  try {
    await saveProfile(patch);
    saved.value = true;
    if (patch.name) await authClient.getSession({ query: { disableCookieCache: true } }).catch(() => undefined);
  }
  catch {
    saveFailed.value = true;
  }
  finally {
    saving.value = false;
    inFlightSave = undefined;
    if (!saveFailed.value) scheduleSave();
  }
}

function saveChanges() {
  clearTimeout(saveTimer);
  if (inFlightSave) return inFlightSave;
  const patch = pendingEdits.value;
  if (!phoneActionPending.value && Object.keys(patch).length) inFlightSave = persistEdits(patch);
  return inFlightSave;
}

onBeforeRouteLeave(async () => {
  await inFlightSave;
  await saveChanges();
});
onBeforeUnmount(() => clearTimeout(saveTimer));

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
    await inFlightSave;
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
      await refresh();
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
    scheduleSave();
  }
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
        <header class="mb-8 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="mb-1 text-lg font-medium text-highlighted">
              Settings
            </h1>
            <p class="max-w-lg text-sm text-muted">
              Manage your identity and integrations.
            </p>
          </div>
          <div v-if="saveFailed" class="flex items-center gap-2 text-sm">
            <p role="alert" class="text-error">Could not save your changes.</p>
            <UButton type="button" color="neutral" variant="link" size="sm" @click="saveChanges">Retry</UButton>
          </div>
          <p v-else role="status" class="text-sm text-muted">
            {{ saving || Object.keys(pendingEdits).length ? 'Saving…' : saved ? 'Changes saved' : '' }}
          </p>
        </header>

        <SettingsNav class="mb-8" />

        <div
          v-if="pending && !profile"
          class="space-y-8"
        >
          <USkeleton class="h-48 rounded-lg" />
          <USkeleton class="h-32 rounded-lg" />
        </div>

        <div
          v-else-if="profile"
          class="space-y-8"
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
                maxlength="100"
              />
              <p v-if="!form.name.trim()" class="mt-2 text-sm text-muted">Enter a name.</p>
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
                  :disabled="phoneActionPending"
                />
                <p v-if="!isCurrentPhone" class="text-sm text-muted">
                  Your current mobile number stays linked until you verify the new one.
                </p>
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
                maxlength="500"
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
        </div>
        <p v-else role="alert" class="text-sm text-error">Could not load your profile.</p>
      </div>
    </template>

  </UDashboardPanel>
</template>
