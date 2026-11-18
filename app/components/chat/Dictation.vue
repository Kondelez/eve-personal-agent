<script setup lang="ts">
import { useDictation } from "~/composables/chat/useDictation";

defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ transcript: [text: string] }>();
const active = defineModel<boolean>("active", { default: false });
const { supported, stage, preview, volume, begin, cancel, finish } = useDictation();
const toast = useToast();
const samples = ref<number[]>([]);
let meter: ReturnType<typeof setInterval> | undefined;

watch(stage, (state) => {
  active.value = state !== "idle";
  clearInterval(meter);
  if (state !== "recording") return;
  samples.value = Array(12).fill(0);
  meter = setInterval(() => { samples.value = [...samples.value.slice(1), volume.value]; }, 75);
}, { flush: "sync" });

onScopeDispose(() => {
  clearInterval(meter);
  active.value = false;
});

function fail(error: unknown) {
  const message = (error as { data?: { statusMessage?: string } })?.data?.statusMessage;
  const description = message ?? (error instanceof Error && error.name === "NotAllowedError"
    ? "Allow microphone access and try again."
    : "Please try recording again.");
  toast.add({ title: "Dictation failed", description, color: "error" });
}

async function done() {
  try {
    const text = await finish();
    if (text) emit("transcript", text);
    else if (stage.value === "idle") toast.add({ title: "No speech detected", color: "neutral" });
  }
  catch (error) {
    fail(error);
  }
}

async function record() {
  try { await begin(() => void done(), fail); }
  catch (error) { fail(error); }
}
</script>

<template>
  <div v-if="stage !== 'idle'" class="flex min-w-0 flex-1 items-center justify-end gap-2">
    <span class="min-w-0 flex-1 truncate text-sm text-muted" role="status">
      {{ preview || (stage === 'starting' ? 'Opening microphone…' : stage === 'finishing' ? 'Transcribing…' : 'Listening…') }}
    </span>
    <span v-if="stage === 'recording'" class="flex h-7 shrink-0 items-center gap-0.5" aria-hidden="true">
      <span
        v-for="(sample, index) in samples"
        :key="index"
        class="w-0.5 rounded-full bg-teal-700 transition-[height] dark:bg-teal-300"
        :style="{ height: `${3 + Math.round(sample * 22)}px` }"
      />
    </span>
    <UButton color="neutral" variant="ghost" icon="i-lucide-x" aria-label="Cancel dictation" @click="cancel" />
    <UButton
      v-if="stage === 'recording' || stage === 'finishing'"
      icon="i-lucide-check"
      aria-label="Finish dictation"
      :loading="stage === 'finishing'"
      @click="done"
    />
  </div>
  <UTooltip v-else :text="supported ? 'Dictate' : 'Microphone unavailable'">
    <UButton
      variant="ghost"
      color="neutral"
      icon="i-lucide-mic"
      aria-label="Dictate"
      class="size-10 justify-center rounded-full"
      :disabled="disabled || !supported"
      @click="record"
    />
  </UTooltip>
</template>
