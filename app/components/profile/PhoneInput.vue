<script setup lang="ts">
import {
  isVerificationPhoneNumber,
  normalizePhoneNumberInput,
  parsePhoneNumber,
  PHONE_CODES,
} from "#shared/phone-codes";

const props = withDefaults(defineProps<{
  defaultCountry?: string;
  size?: "sm" | "md" | "lg" | "xl";
  disabled?: boolean;
}>(), {
  defaultCountry: "FR",
  size: "lg",
});

const model = defineModel<string>({ default: "" });
const emit = defineEmits<{ commit: [value: string] }>();

const countryCode = ref(props.defaultCountry);
const localNumber = ref("");

const country = computed(() => PHONE_CODES.find(entry => entry.code === countryCode.value));
const dialCode = computed(() => country.value?.dialCode ?? "+33");
const placeholder = computed(() => country.value?.mask.replaceAll("#", "_") ?? "Mobile number");
const showDialCode = computed(() => !/^(?:\+|00)/.test(localNumber.value.trim()));

function syncFromModel(value: string) {
  if (!isVerificationPhoneNumber(value)) {
    localNumber.value = value;
    return;
  }
  const parsed = parsePhoneNumber(value, countryCode.value);
  countryCode.value = parsed.countryCode;
  localNumber.value = parsed.local;
}

function updateNumber(value: string) {
  localNumber.value = value;
  model.value = normalizePhoneNumberInput(value, countryCode.value);
}

function updateCountry(value: string) {
  if (value === countryCode.value) return;
  countryCode.value = value;
  updateNumber("");
}

function commitNumber(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  updateNumber(event.target.value);
  syncFromModel(model.value);
  emit("commit", model.value);
}

watch(model, (value) => {
  if (value !== normalizePhoneNumberInput(localNumber.value, countryCode.value)) {
    syncFromModel(value);
  }
}, { immediate: true });
</script>

<template>
  <UFieldGroup class="w-full">
    <USelectMenu
      :model-value="countryCode"
      :items="PHONE_CODES"
      value-key="code"
      :search-input="{
        placeholder: 'Search country…',
        icon: 'i-lucide-search',
      }"
      :filter-fields="['name', 'code', 'dialCode']"
      :content="{ align: 'start' }"
      :size="size"
      :disabled="disabled"
      :ui="{
        base: 'pe-8',
        content: 'min-w-48',
        placeholder: 'hidden',
        trailingIcon: 'size-4',
      }"
      trailing-icon="i-lucide-chevrons-up-down"
      @update:model-value="updateCountry"
    >
      <span class="flex size-5 items-center text-lg">
        {{ country?.emoji ?? "🇫🇷" }}
      </span>

      <template #item-leading="{ item }">
        <span class="flex size-5 items-center text-lg">
          {{ item.emoji }}
        </span>
      </template>

      <template #item-label="{ item }">
        {{ item.name }} ({{ item.dialCode }})
      </template>
    </USelectMenu>

    <UInput
      :model-value="localNumber"
      type="tel"
      inputmode="tel"
      autocomplete="tel"
      name="tel"
      aria-label="Mobile number"
      class="min-w-0 flex-1"
      :size="size"
      :disabled="disabled"
      :placeholder="placeholder"
      :style="{ '--dial-code-length': `${dialCode.length + 1.5}ch` }"
      :ui="{
        base: showDialCode ? 'ps-(--dial-code-length) w-full' : 'w-full',
        leading: 'pointer-events-none text-base md:text-sm text-muted',
      }"
      @update:model-value="updateNumber"
      @change="commitNumber"
      @blur="commitNumber"
    >
      <template v-if="showDialCode" #leading>
        {{ dialCode }}
      </template>
    </UInput>
  </UFieldGroup>
</template>
